import { ROLES } from "@/lib/roles";
import { PROMPTS } from "@/lib/prompts";
import { appendToRoleHistory, getRoleHistory } from "@/lib/memoryStore";
import OpenAI from "openai";

type ChatRole = "user" | "assistant";
type Provider = "openai" | "openrouter";

function createClient(provider: Provider) {
  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing in .env.local");
    }

    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getProviderOrder(): readonly Provider[] {
  const primary = (process.env.LLM_PROVIDER || "openrouter").toLowerCase();

  if (primary === "openai") {
    return ["openai", "openrouter"] as const;
  }

  return ["openrouter", "openai"] as const;
}

function getModel(provider: Provider, roleId?: string) {
  const isTalk = roleId === "talk";

  if (provider === "openrouter") {
    if (isTalk) {
      return (
        process.env.OPENROUTER_MODEL_TALK ||
        process.env.OPENROUTER_MODEL ||
        "openai/gpt-4o"
      );
    }

    return process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  }

  if (isTalk) {
    return process.env.OPENAI_MODEL_TALK || process.env.OPENAI_MODEL || "gpt-4o";
  }

  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function buildDefaultSystemPrompt(title: string) {
  return (
    `Ты — ${title}. ` +
    "ЦА: женщины 25–40, доход 100+, хотят порядок в жизни и финансах. " +
    "Стиль: тепло, уверенно, по делу, без морализаторства. " +
    "Отвечай компактно, естественно и законченно. " +
    "Не используй markdown-разметку вроде ** и ###. " +
    "Если запрос про здоровье или психику — мягко рекомендуй специалиста и безопасные общие рекомендации."
  );
}

function getMaxTokensByRole(roleId: string) {
  const maxTokensByRole: Record<string, number> = {
    talk: 220,
    finance: 260,
    wellness: 240,
    planner: 240,
  };

  return maxTokensByRole[roleId] ?? 240;
}

function trimIncompleteReply(text: string) {
  const clean = text.trim();
  if (!clean) return "Нет ответа";

  const lastChar = clean.slice(-1);
  const isComplete = [".", "!", "?", "…"].includes(lastChar);

  if (isComplete) return clean;

  const lastSentenceEnd = Math.max(
    clean.lastIndexOf("."),
    clean.lastIndexOf("!"),
    clean.lastIndexOf("?"),
    clean.lastIndexOf("…")
  );

  if (lastSentenceEnd >= 0) {
    return clean.slice(0, lastSentenceEnd + 1).trim();
  }

  return clean;
}

export async function chatReply(params: {
  userId: string;
  roleId: string;
  message: string;
}) {
  const role = ROLES[params.roleId as keyof typeof ROLES];
  const title = role?.title ?? params.roleId;

  appendToRoleHistory({
    userId: params.userId,
    roleId: params.roleId,
    role: "user",
    content: params.message,
  });

  const roleHistory = getRoleHistory({
    userId: params.userId,
    roleId: params.roleId,
  });

  const promptId = (role as any)?.promptId as keyof typeof PROMPTS | undefined;
  const rolePrompt =
    promptId && PROMPTS[promptId] ? String(PROMPTS[promptId]).trim() : "";

    const systemPrompt =
  (rolePrompt || buildDefaultSystemPrompt(title)) +
  "\n\nВАЖНО:\n" +
  "- Отвечай естественно и по делу.\n" +
  "- Не пиши слишком длинно без необходимости.\n" +
  "- Не цитируй прошлые сообщения дословно.\n" +
  "- Не используй markdown-разметку вроде ** и ###.\n" +
  "- Не обрывай ответ на полуслове.\n";

  const messages: Array<{ role: ChatRole | "system"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  const recentHistory = roleHistory.slice(-10);

  for (const m of recentHistory) {
    messages.push({
      role: m.role,
      content: String(m.content ?? ""),
    });
  }

  const providerOrder = getProviderOrder();
  const maxTokens = getMaxTokensByRole(params.roleId);

  let lastError: any = null;

  for (const provider of providerOrder) {
    try {
      const client = createClient(provider);
      const model = getModel(provider, params.roleId);

      const completion = await client.chat.completions.create({
        model,
        messages,
        temperature: params.roleId === "planner" ? 0.5 : 0.7,
        max_tokens: maxTokens,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
      });

      let reply = completion.choices?.[0]?.message?.content?.trim() || "Нет ответа";

      if (completion.choices?.[0]?.finish_reason === "length") {
        reply = trimIncompleteReply(reply);
      }

          appendToRoleHistory({
        userId: params.userId,
        roleId: params.roleId,
        role: "assistant",
        content: reply,
      });

      return reply;
    } catch (err: any) {
      lastError = err;
      console.error(`[LLM:${provider}] failed:`, err?.message || err);

      const code =
        err?.code ||
        err?.response?.data?.error?.code ||
        err?.error?.code ||
        null;

      if (code) {
        console.error(`[LLM:${provider}] error code:`, code);
      }

      continue;
    }
  }

  console.error("All providers failed:", lastError?.message || lastError);
  return "Сейчас не получилось получить ответ от AI. Попробуй ещё раз через минуту.";
}