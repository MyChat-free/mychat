// lib/memoryStore.ts
// In-memory store = хранение "в памяти" (пропадёт при перезапуске сервера)

export type ChatRole = "user" | "assistant";

export type Message = {
  role: ChatRole;
  content: string;
  ts: number;
};

export type RoleId = string;

export type RoleSession = {
  messages: Message[];
};

type SharedMemoryItem = {
  roleId: string;
  role: ChatRole;
  content: string;
  ts: number;
};

type UserState = {
  roles: Record<RoleId, RoleSession>;
  sharedFeed: SharedMemoryItem[];
  lastActivityAt: number;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 минут
const ROLE_HISTORY_MAX = 20;
const SHARED_FEED_MAX = 40;

// Глобальный объект на сервере
const store: Record<string, UserState> = {};

function ensureUser(userId: string): UserState {
  if (!store[userId]) {
    store[userId] = {
      roles: {},
      sharedFeed: [],
      lastActivityAt: Date.now(),
    };
  }
  return store[userId];
}

function ensureRoleSession(user: UserState, roleId: string): RoleSession {
  if (!user.roles[roleId]) {
    user.roles[roleId] = { messages: [] };
  }
  return user.roles[roleId];
}

function applySessionTimeout(user: UserState) {
  const now = Date.now();

  if (now - user.lastActivityAt > SESSION_TTL_MS) {
    user.roles = {};
    user.sharedFeed = [];
  }

  user.lastActivityAt = now;
}

export function getRoleHistory(params: { userId: string; roleId: string }) {
  const user = ensureUser(params.userId);
  applySessionTimeout(user);

  const session = ensureRoleSession(user, params.roleId);
  return session.messages;
}

export function appendToRoleHistory(params: {
  userId: string;
  roleId: string;
  role: ChatRole;
  content: string;
}) {
  const user = ensureUser(params.userId);
  applySessionTimeout(user);

  const session = ensureRoleSession(user, params.roleId);
  const now = Date.now();

  const message: Message = {
    role: params.role,
    content: params.content,
    ts: now,
  };

  session.messages.push(message);

  if (session.messages.length > ROLE_HISTORY_MAX) {
    session.messages = session.messages.slice(-ROLE_HISTORY_MAX);
  }

  user.sharedFeed.push({
    roleId: params.roleId,
    role: params.role,
    content: params.content,
    ts: now,
  });

  if (user.sharedFeed.length > SHARED_FEED_MAX) {
    user.sharedFeed = user.sharedFeed.slice(-SHARED_FEED_MAX);
  }
}

export function getCrossRoleContext(params: {
  userId: string;
  currentRoleId: string;
  limit?: number;
}) {
  const user = ensureUser(params.userId);
  applySessionTimeout(user);

  const limit = params.limit ?? 8;

  const items = user.sharedFeed
    .filter((item) => item.roleId !== params.currentRoleId)
    .slice(-limit);

  if (!items.length) return "";

  return items
    .map((item) => {
      const speaker = item.role === "user" ? "Пользователь" : "AI";
      return `[${item.roleId}] ${speaker}: ${item.content}`;
    })
    .join("\n");
}

export function clearRoleHistory(params: { userId: string; roleId: string }) {
  const user = ensureUser(params.userId);
  applySessionTimeout(user);

  user.roles[params.roleId] = { messages: [] };
}

export function clearAllUserMemory(params: { userId: string }) {
  const user = ensureUser(params.userId);
  user.roles = {};
  user.sharedFeed = [];
  user.lastActivityAt = Date.now();
}