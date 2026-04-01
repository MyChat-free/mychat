"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ROLES } from "@/lib/roles";

type ChatRole = "user" | "assistant";

type Message = {
  role: ChatRole;
  content: string;
};

const ROLE_ORDER = ["talk", "finance", "wellness", "planner"] as const;

const ROLE_BUTTONS = [
  { id: "talk", label: "💬 Поговорить" },
  { id: "finance", label: "💰 Деньги" },
  { id: "planner", label: "📋 План" },
  { id: "wellness", label: "🌿 Самочувствие" },
] as const;

function getInitialMessage(roleId: string) {
  if (roleId === "talk") {
    return "Привет. Ну как ты сегодня? Что у тебя сейчас в голове?";
  }

  if (roleId === "finance") {
    return "Привет 💰 Давай спокойно разберёмся с деньгами. Что сейчас больше всего волнует: доход, траты, накопления или инвестиции?";
  }

  if (roleId === "planner") {
    return "Привет 📋 Давай разложим всё по полочкам. Что сейчас больше всего грузит: задачи, дедлайны или общий хаос?";
  }

  if (roleId === "wellness") {
    return "Привет 🌿 Давай посмотрим, как ты себя чувствуешь. Что сейчас больше всего беспокоит: усталость, сон, энергия или привычки?";
  }

  return "Привет 🙂 Как ты сегодня?";
}
const HISTORY_LIMIT = 20;

function getHistoryKey(roleId: string) {
  return `mychat_history_${roleId}_v1`;
}

function loadLocalHistory(roleId: string): Message[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getHistoryKey(roleId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validMessages = parsed.filter(
      (item: unknown): item is Message =>
        typeof item === "object" &&
        item !== null &&
        "role" in item &&
        "content" in item &&
        ((item as Message).role === "user" || (item as Message).role === "assistant") &&
        typeof (item as Message).content === "string"
    );

    return validMessages.slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveLocalHistory(roleId: string, messages: Message[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getHistoryKey(roleId),
      JSON.stringify(messages.slice(-HISTORY_LIMIT))
    );
  } catch {
    // ignore localStorage errors
  }
}

function getOrCreateUserId() {
  if (typeof window === "undefined") return "";

  const storageKey = "mychat_user_id_v2";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const newId =
    "user_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);

  window.localStorage.setItem(storageKey, newId);
  return newId;
}

export default function RoleChatPage() {
  const params = useParams<{ roleId: string }>();
  const roleId = params?.roleId;

  const role = useMemo(() => {
    if (!roleId) return null;
    return ROLES[roleId as keyof typeof ROLES] ?? null;
  }, [roleId]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [userId, setUserId] = useState("");
  const [isHydrating, setIsHydrating] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = getOrCreateUserId();
    setUserId(id);
  }, []);

  useEffect(() => {
    if (!roleId || !userId) return;
  
    setIsHydrating(true);
  
    const history = loadLocalHistory(roleId);
  
    if (history.length > 0) {
      setMessages(history);
    } else {
      setMessages([
        {
          role: "assistant",
          content: getInitialMessage(roleId),
        },
      ]);
    }
  
    setIsHydrating(false);
  }, [roleId, userId]);
  useEffect(() => {
    if (!roleId || !userId) return;
    if (messages.length === 0) return;
    if (isHydrating) return;
  
    saveLocalHistory(roleId, messages);
  }, [roleId, userId, messages, isHydrating]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !role || isThinking || !userId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsThinking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          roleId: role.id,
          message: text,
        }),
      });

      const data = await res.json();
      const reply = data?.reply ?? "Пустой ответ.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Ошибка сети/сервера. Попробуй ещё раз.",
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  const showRoleButtons =
    !isHydrating &&
    messages.length === 1 &&
    messages[0]?.role === "assistant";

  if (!role) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <a href="/" style={{ display: "inline-block", marginBottom: 16 }}>
          ← Назад
        </a>
        <h1>Роль не найдена</h1>
        <p>Такой роли нет: {String(roleId ?? "")}</p>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#fff",
        fontFamily: "system-ui",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#fff",
          borderBottom: "1px solid #eee",
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <a href="/" style={{ textDecoration: "none", color: "#111", fontSize: 14 }}>
            ← Назад
          </a>

          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{role.title}</div>
            <div style={{ fontSize: 12, opacity: 0.65 }}>{role.description}</div>
          </div>

          <a href="/" style={{ textDecoration: "none", color: "#111", fontSize: 14 }}>
            ⋯
          </a>
        </div>
      </header>

      <section
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
          padding: "16px 16px 120px",
          display: "grid",
          gap: 12,
        }}
      >
        {messages.map((m, idx) => {
          const isAssistant = m.role === "assistant";

          return (
            <div key={idx}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid #e8e8e8",
                  background: isAssistant ? "#fafafa" : "#fff",
                  maxWidth: "88%",
                  marginLeft: isAssistant ? 0 : "auto",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 6 }}>
                  {isAssistant ? role.title : "Вы"}
                </div>

                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                  {m.content}
                </div>
              </div>

              {idx === 0 && showRoleButtons && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  {ROLE_BUTTONS.map((item) => (
                    <a
                      key={item.id}
                      href={`/chat/${item.id}`}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: item.id === role.id ? "#111" : "#fff",
                        color: item.id === role.id ? "#fff" : "#111",
                        textDecoration: "none",
                        fontSize: 14,
                      }}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isThinking && (
          <div
            style={{
              padding: 14,
              borderRadius: 16,
              border: "1px solid #e8e8e8",
              background: "#fafafa",
              maxWidth: "88%",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 6 }}>
              {role.title}
            </div>
            <div>Печатает...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </section>

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 64,
          background: "#fff",
          borderTop: "1px solid #eee",
          padding: 12,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            gap: 10,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Напиши сообщение..."
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              fontSize: 16,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button
            onClick={handleSend}
            disabled={isThinking}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontSize: 14,
            }}
          >
            {isThinking ? "..." : "➤"}
          </button>
        </div>
      </div>

      <nav
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#fff",
          borderTop: "1px solid #ddd",
          padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
            textAlign: "center",
          }}
        >
          {ROLE_ORDER.map((id) => {
            const item = ROLES[id];
            const isActive = item.id === role.id;

            const icon =
              id === "talk"
                ? "💬"
                : id === "finance"
                ? "💰"
                : id === "wellness"
                ? "🌿"
                : "📋";

            const label =
              id === "talk"
                ? "Чат"
                : id === "finance"
                ? "Деньги"
                : id === "wellness"
                ? "Велнес"
                : "План";

            return (
              <a
                key={id}
                href={item.path}
                style={{
                  textDecoration: "none",
                  color: isActive ? "#111" : "#666",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                <div>{label}</div>
              </a>
            );
          })}

          <a
            href="/"
            style={{
              textDecoration: "none",
              color: "#666",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 4 }}>⋯</div>
            <div>Меню</div>
          </a>
        </div>
      </nav>
    </main>
  );
}