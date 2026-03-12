// lib/memoryStore.ts
// In-memory store = хранение "в памяти" (пропадёт при перезапуске сервера)

export type ChatRole = "user" | "assistant";

export type Message = {
  role: ChatRole;
  content: string;
  ts: number; // timestamp (время)
};

export type RoleId = string;

export type RoleSession = {
  messages: Message[]; // короткая история (последние N)
  summary: string;     // краткое резюме диалога (сжатая память)
  lastActivityAt: number;
};

type UserState = {
  roles: Record<RoleId, RoleSession>;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Глобальный объект на сервере (в dev может сбрасываться чаще из-за hot reload)
const store: Record<string, UserState> = {};

function ensureUser(userId: string): UserState {
  if (!store[userId]) store[userId] = { roles: {} };
  return store[userId];
}

function ensureRoleSession(user: UserState, roleId: string): RoleSession {
  if (!user.roles[roleId]) {
    user.roles[roleId] = {
      messages: [],
      summary: "",
      lastActivityAt: Date.now(),
    };
  }
  return user.roles[roleId];
}

function applySessionTimeout(session: RoleSession) {
  const now = Date.now();
  if (now - session.lastActivityAt > SESSION_TTL_MS) {
    session.messages = [];
    session.summary = "";
    session.lastActivityAt = now;
  }
}

/**
 * Возвращает короткую историю (последние N сообщений).
 * Summary НЕ возвращает — для этого есть getRoleSummary.
 */
export function getRoleHistory(params: { userId: string; roleId: string }) {
  const user = ensureUser(params.userId);
  const session = ensureRoleSession(user, params.roleId);

  applySessionTimeout(session);

  return session.messages;
}

export function getRoleSummary(params: { userId: string; roleId: string }) {
  const user = ensureUser(params.userId);
  const session = ensureRoleSession(user, params.roleId);

  applySessionTimeout(session);

  return session.summary || "";
}

export function setRoleSummary(params: {
  userId: string;
  roleId: string;
  summary: string;
}) {
  const user = ensureUser(params.userId);
  const session = ensureRoleSession(user, params.roleId);

  applySessionTimeout(session);

  session.summary = (params.summary || "").trim();
  session.lastActivityAt = Date.now();
}

/**
 * Обрезает историю: оставляет только последние keepLast сообщений
 */
export function compactRoleHistory(params: {
  userId: string;
  roleId: string;
  keepLast: number;
}) {
  const user = ensureUser(params.userId);
  const session = ensureRoleSession(user, params.roleId);

  applySessionTimeout(session);

  const keep = Math.max(0, params.keepLast);
  if (session.messages.length > keep) {
    session.messages = session.messages.slice(session.messages.length - keep);
  }

  session.lastActivityAt = Date.now();
}

export function appendToRoleHistory(params: {
  userId: string;
  roleId: string;
  role: ChatRole;
  content: string;
}) {
  const user = ensureUser(params.userId);
  const session = ensureRoleSession(user, params.roleId);

  applySessionTimeout(session);

  const now = Date.now();
  session.lastActivityAt = now;
  session.messages.push({ role: params.role, content: params.content, ts: now });

  // MVP: ограничим историю (без summary это было MAX=20, теперь пусть будет чуть больше,
  // но мы будем сжимать через summary в chatService)
  const HARD_MAX = 30;
  if (session.messages.length > HARD_MAX) {
    session.messages = session.messages.slice(session.messages.length - HARD_MAX);
  }
}

export function clearRoleHistory(params: { userId: string; roleId: string }) {
  const user = ensureUser(params.userId);
  user.roles[params.roleId] = {
    messages: [],
    summary: "",
    lastActivityAt: Date.now(),
  };
}