// lib/chatService.ts
import { ROLES } from "@/lib/roles";
import { PROMPTS } from "@/lib/prompts";
import {
  appendToRoleHistory,
  getCrossRoleContext,
  getRoleHistory,
} from "@/lib/memoryStore";
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
  if (primary === "openai") return ["openai", "openrouter"] as const;
  return ["openrouter", "openai"] as const;
}

function getModel(provider: Provider) {
  if (provider === "openrouter") {
    return process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function buildDefaultSystemPrompt(title: string) {
  return (
    `Ты — ${title}. ` +
    "ЦА: женщины 25–40, доход 100+, хотят порядок в жизни и финансах. " +
    "Стиль: тепло, уверенно, по делу, без морализаторства. " +
    "Отвечай компактно и законченно. " +
    "Если запрос про здоровье/психику — мягко рекомендуй специалиста и безопасные общие рекомендации."
  );
}

function getMaxTokensByRole(roleId: string) {
  const maxTokensByRole: Record<string, number> = {
    talk: 180,
    finance: 280,
    wellness: 220,
    planner: 260,
  };

  return maxTokensByRole[roleId] ?? 220;
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

  const lastLineBreak = clean.lastIndexOf("\n");
  if (lastLineBreak >= 0) {
    return clean.slice(0, lastLineBreak).trim();
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

  // 1) сохраняем сообщение пользователя в память роли + общую память
  appendToRoleHistory({
    userId: params.userId,
    roleId: params.roleId,
    role: "user" as ChatRole,
    content: params.message,
  });

  const roleHistory = getRoleHistory({
    userId: params.userId,
    roleId: params.roleId,
  });

  const crossRoleContext = getCrossRoleContext({
    userId: params.userId,
    currentRoleId: params.roleId,
    limit: 8,
  });

  const messages = roleHistory.map((m) => ({
    role: m.role as ChatRole,
    content: String(m.content ?? ""),
  }));

  const promptId = (role as any)?.promptId as keyof typeof PROMPTS | undefined;
  const rolePrompt =
    promptId && PROMPTS[promptId] ? String(PROMPTS[promptId]).trim() : "";

  const compactReplyRule =
    "\n\nВАЖНО ДЛЯ ФОРМАТА ОТВЕТА:\n" +
    "- Отвечай компактно.\n" +
    "- Максимум 3 смысловых блока.\n" +
    "- Если ответ не помещается, сократи его, но заверши мысль.\n" +
    "- Никогда не обрывай предложение на полуслове.\n" +
    "- Не используй markdown-разметку вроде ** и ###.\n" +
    "- Лучше меньше, но законченно.\n";

  const systemPrompt =
    (rolePrompt || buildDefaultSystemPrompt(title)) + compactReplyRule;

  const providerOrder = getProviderOrder();
  const maxTokens = getMaxTokensByRole(params.roleId);

  let lastError: any = null;

  for (const provider of providerOrder) {
    try {
      const client = createClient(provider);
      const model = getModel(provider);

      const finalMessages: any[] = [{ role: "system", content: systemPrompt }];

      if (crossRoleContext) {
        finalMessages.push({
          role: "system",
          content:
            "Контекст из других ролей этого же пользователя. Используй осторожно как дополнительную память, не цитируй дословно без необходимости:\n" +
            crossRoleContext,
        });
      }

      finalMessages.push(...messages);

      const reasoningRoles = new Set(["finance", "planner"]);
      let completion;

      if (reasoningRoles.has(params.roleId)) {
        const reasoning = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                systemPrompt +
                "\n\nСначала сделай внутренний краткий анализ запроса и план ответа. Не обращайся к пользователю. Не используй markdown.",
            },
            ...finalMessages.filter((m) => m.role !== "system"),
          ] as any,
          temperature: 0.4,
          max_tokens: 160,
          presence_penalty: 0,
          frequency_penalty: 0,
        });

        completion = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...finalMessages.filter((m) => m.role !== "system"),
            {
              role: "assistant",
              content:
                "Черновой анализ:\n" +
                (reasoning.choices?.[0]?.message?.content ?? ""),
            },
          ] as any,
          temperature: 0.7,
          max_tokens: maxTokens,
          presence_penalty: 0.3,
          frequency_penalty: 0.2,
        });
      } else {
        completion = await client.chat.completions.create({
          model,
          messages: finalMessages,
          temperature: 0.7,
          max_tokens: maxTokens,
          presence_penalty: 0.3,
          frequency_penalty: 0.2,
        });
      }

      let reply = completion.choices?.[0]?.message?.content?.trim() || "Нет ответа";
      const finishReason = completion.choices?.[0]?.finish_reason;

      if (finishReason === "length") {
        reply = trimIncompleteReply(reply);
      }

      // 2) сохраняем ответ ассистента в память роли + общую память
      appendToRoleHistory({
        userId: params.userId,
        roleId: params.roleId,
        role: "assistant" as ChatRole,
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

      if (code) console.error(`[LLM:${provider}] error code:`, code);
      continue;
    }
  }

  console.error("All providers failed:", lastError?.message || lastError);
  return "Сейчас не получилось получить ответ от AI. Попробуй ещё раз через минуту.";
}