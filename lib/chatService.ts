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

function isTalkRole(roleId: string) {
  return roleId === "talk";
}

function looksGenericTalkReply(text: string) {
  const lower = text.toLowerCase();

  const genericPatterns = [
    "это нормально",
    "многие сталкиваются",
    "часто бывает",
    "важно помнить",
    "каждый опыт",
    "конфликты могут",
    "может быть очень тяжело",
    "может быть очень непросто",
    "ты не одинок",
    "это действительно тяжело",
    "понимаю, это действительно",
  ];

  return genericPatterns.some((pattern) => lower.includes(pattern));
}

async function rewriteTalkReplyIfGeneric(params: {
  client: OpenAI;
  model: string;
  userMessage: string;
  draftReply: string;
}) {
  const { client, model, userMessage, draftReply } = params;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.6,
    max_tokens: 180,
    messages: [
      {
        role: "system",
        content:
          "Перепиши ответ для роли 'Поговорить'. " +
          "Сделай его более живым, конкретным и человечным. " +
          "Не обобщай. Не пиши фразы вроде 'это нормально', 'многие сталкиваются', 'часто бывает'. " +
          "Не объясняй жизнь и не читай нотации. " +
          "Не звучи как психолог, специалист или наставник. " +
          "Говори как человек рядом. " +
          "Нужна структура: 1) точное попадание в суть, 2) мягкая интерпретация, 3) один короткий вопрос. " +
          "Коротко. Без markdown.",
      },
      {
        role: "user",
        content:
          `Сообщение пользователя:\n${userMessage}\n\n` +
          `Текущий черновик ответа:\n${draftReply}\n\n` +
          "Перепиши лучше.",
      },
    ],
  });

  return completion.choices?.[0]?.message?.content?.trim() || draftReply;
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

  const extraTalkStyle = isTalkRole(params.roleId)
    ? "\n\nСТИЛЬ ДЛЯ РОЛИ 'Поговорить':\n" +
      "- Не обобщай (не говори 'часто бывает', 'многие сталкиваются').\n" +
      "- Не объясняй жизнь и не давай интерпретации сверху.\n" +
      "- Говори как живой человек, а не как эксперт.\n" +
      "- Не растягивай мысли — коротко и точно.\n" +
      "- Лучше чуть недосказать, чем перегрузить.\n" +
      "- Один фокус — одна мысль.\n"
    : "";

  const systemPrompt =
    (rolePrompt || buildDefaultSystemPrompt(title)) +
    "\n\nВАЖНО ДЛЯ ФОРМАТА ОТВЕТА:\n" +
    "- Отвечай естественно и по делу.\n" +
    "- Не пиши слишком длинно без необходимости.\n" +
    "- Если уместно, учитывай состояние и контекст пользователя из прошлых диалогов.\n" +
    "- Не цитируй прошлые сообщения дословно.\n" +
    "- Не делай вид, что знаешь больше, чем есть в контексте.\n" +
    "- Не используй markdown-разметку вроде ** и ###.\n" +
    "- Не обрывай ответ на полуслове.\n" +
    extraTalkStyle;

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
        temperature: params.roleId === "planner" ? 0.5 : 0.9,
        max_tokens: maxTokens,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
      });

      let reply = completion.choices?.[0]?.message?.content?.trim() || "Нет ответа";

      if (completion.choices?.[0]?.finish_reason === "length") {
        reply = trimIncompleteReply(reply);
      }

      if (isTalkRole(params.roleId) && looksGenericTalkReply(reply)) {
        try {
          reply = await rewriteTalkReplyIfGeneric({
            client,
            model,
            userMessage: params.message,
            draftReply: reply,
          });
        } catch (rewriteErr: any) {
          console.error(
            "[LLM:rewriteTalkReplyIfGeneric] failed:",
            rewriteErr?.message || rewriteErr
          );
        }
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