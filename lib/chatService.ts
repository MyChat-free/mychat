// lib/chatService.ts
import { ROLES } from "@/lib/roles";
import { PROMPTS } from "@/lib/prompts";
import {
  appendToRoleHistory,
  compactRoleHistory,
  getRoleHistory,
  getRoleSummary,
  setRoleSummary,
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
    "Отвечай компактно, максимум в 3 смысловых блоках. " +
    "Если ответ не помещается — сокращай, но обязательно заканчивай мысль. " +
    "Никогда не обрывай предложение на полуслове. " +
    "Лучше ответить короче, но законченно. " +
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

function toChatMessages(history: { role: ChatRole; content: string }[]) {
  return history.map((m) => ({
    role: m.role,
    content: String(m.content ?? ""),
  }));
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

/**
 * Если история стала длинной — обновляем summary и режем старые сообщения.
 */
async function compressIfNeeded(params: {
  client: OpenAI;
  model: string;
  userId: string;
  roleId: string;
  systemPrompt: string;
}) {
  const KEEP_LAST = 12;
  const TRIGGER_LEN = 18;

  const history = getRoleHistory({ userId: params.userId, roleId: params.roleId });
  if (history.length < TRIGGER_LEN) return;

  const summary = getRoleSummary({ userId: params.userId, roleId: params.roleId });

  const cutIndex = Math.max(0, history.length - KEEP_LAST);
  const older = history.slice(0, cutIndex);

  if (older.length < 6) return;

  const olderMsgs = toChatMessages(
    older.map((m) => ({ role: m.role as ChatRole, content: m.content }))
  );

  const summarizerSystem =
    "Ты кратко сжимаешь историю диалога в summary.\n" +
    "Сделай новое summary на русском языке, 5–8 строк максимум.\n" +
    "Сохраняй: факты о пользователе, цели, числа, ограничения, решения и договорённости.\n" +
    "Не добавляй выдуманных фактов.\n" +
    "Пиши коротко и по делу.";

  const summarizerInput = [
    {
      role: "system" as const,
      content: summarizerSystem,
    },
    {
      role: "user" as const,
      content:
        `Текущее summary:\n${summary || "(пусто)"}\n\n` +
        `Старая часть переписки для сжатия:\n` +
        olderMsgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n"),
    },
  ];

  const res = await params.client.chat.completions.create({
    model: params.model,
    messages: summarizerInput as any,
    temperature: 0.2,
    max_tokens: 180,
    presence_penalty: 0,
    frequency_penalty: 0,
  });

  const newSummary = res.choices?.[0]?.message?.content?.trim();
  if (!newSummary) return;

  setRoleSummary({ userId: params.userId, roleId: params.roleId, summary: newSummary });
  compactRoleHistory({ userId: params.userId, roleId: params.roleId, keepLast: KEEP_LAST });
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
    role: "user" as ChatRole,
    content: params.message,
  });

  const promptId = (role as any)?.promptId as keyof typeof PROMPTS | undefined;
  const rolePrompt =
    promptId && PROMPTS[promptId] ? String(PROMPTS[promptId]).trim() : "";

    const compactReplyRule =
"\n\nВАЖНО ДЛЯ ФОРМАТА ОТВЕТА:\n" +
"- Отвечай компактно.\n" +
"- Максимум 3 смысловых блока.\n" +
"- Если ответ не помещается, сократи его, но заверши мысль.\n" +
"- Никогда не обрывай предложение на полуслове.\n" +
"- Лучше меньше, но законченно.\n";


  const systemPrompt = (rolePrompt || buildDefaultSystemPrompt(title)) + compactReplyRule;

  const providerOrder = getProviderOrder();
  const maxTokens = getMaxTokensByRole(params.roleId);

  let lastError: any = null;

  for (const provider of providerOrder) {
    try {
      const client = createClient(provider);
      const model = getModel(provider);

      await compressIfNeeded({
        client,
        model,
        userId: params.userId,
        roleId: params.roleId,
        systemPrompt,
      });

      const summary = getRoleSummary({ userId: params.userId, roleId: params.roleId });
      const history = getRoleHistory({ userId: params.userId, roleId: params.roleId });

      const messages = toChatMessages(
        history.map((m) => ({ role: m.role as ChatRole, content: m.content }))
      );

      const finalMessages: any[] = [{ role: "system", content: systemPrompt }];

      if (summary) {
        finalMessages.push({
          role: "system",
          content:
            "Краткое резюме предыдущих сообщений. Используй как контекст:\n" + summary,
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
                "\n\nСначала сделай внутренний краткий анализ и план ответа. Не обращайся к пользователю. Пиши только черновую логику.",
            },
            ...finalMessages.filter((m) => m.role !== "system").map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ] as any,
          temperature: 0.4,
          max_tokens: 180,
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
              content: "Черновой анализ:\n" + (reasoning.choices?.[0]?.message?.content ?? ""),
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