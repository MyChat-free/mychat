// app/api/chat/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { chatReply } from "@/lib/chatService";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roleId, message, userId } = body || {};

    if (!roleId || !message) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const reply = await chatReply({
      userId: userId || "demo",
      roleId,
      message,
    });

    return NextResponse.json({ reply }, { status: 200 });
  } catch (err: any) {
    console.error("API /api/chat error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}