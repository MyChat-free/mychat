import { PromptId } from "@/lib/prompts";

export type Role = {
  id: string;
  title: string;
  description: string;
  path: string;
  promptId: PromptId;
};

export const ROLES: Record<string, Role> = {
  talk: {
    id: "talk",
    title: "Болталка",
    description: "Тёплый поддерживающий диалог.",
    path: "/chat/talk",
    promptId: "talk",
  },

  finance: {
    id: "finance",
    title: "Финансист",
    description: "Поможет с бюджетом, целями и планом денег.",
    path: "/chat/finance",
    promptId: "finance",
  },

  wellness: {
    id: "wellness",
    title: "Велнес-наставник",
    description: "Сон, энергия, привычки и мягкая забота о себе.",
    path: "/chat/wellness",
    promptId: "wellness",
  },

  planner: {
    id: "planner",
    title: "Планировщик",
    description: "Разложит цель на шаги и поможет держать фокус.",
    path: "/chat/planner",
    promptId: "planner",
  },
};