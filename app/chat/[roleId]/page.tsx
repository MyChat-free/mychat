"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ROLES } from "@/lib/roles";

type ChatRole = "user" | "assistant";

type Message = {
  role: ChatRole;
  content: string;
};

export default function RoleChatPage() {
  const params = useParams<{ roleId: string }>();
  const roleId = params?.roleId; // берем из URL: /chat/talk -> roleId="talk"

  const role = useMemo(() => {
    if (!roleId) return null;
    return ROLES[roleId as keyof typeof ROLES] ?? null;
  }, [roleId]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || !role) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsThinking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: role.id,
          message: text,
          history: messages,
        }),
      });

      const data = await res.json();
      const reply = data?.reply ?? "Пустой ответ.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Ошибка сети/сервера. Попробуй ещё раз." },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

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
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720, margin: "0 auto" }}>
      <a href="/" style={{ display: "inline-block", marginBottom: 16 }}>
        ← Назад
      </a>

      <h1 style={{ fontSize: 28, fontWeight: 800 }}>{role.title}</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>{role.description}</p>

      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {messages.map((m, idx) => (
          <div
            key={idx}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              background: m.role === "user" ? "#fff" : "#fafafa",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
              {m.role === "user" ? "Вы" : "Бот"}
            </div>
            <div>{m.content}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Напиши сообщение..."
          style={{ flex: 1, padding: 10 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
        />
        <button onClick={handleSend} disabled={isThinking} style={{ padding: "10px 14px" }}>
          {isThinking ? "..." : "Отправить"}
        </button>
      </div>
    </main>
  );
}