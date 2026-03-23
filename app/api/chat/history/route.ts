import { NextResponse } from "next/server";
import { getRoleHistory } from "@/lib/memoryStore";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, roleId } = body || {};

    if (!userId || !roleId) {
      return NextResponse.json(
        { error: "userId and roleId are required" },
        { status: 400 }
      );
    }

    const messages = getRoleHistory({ userId, roleId });

    return NextResponse.json({ messages }, { status: 200 });
  } catch (err: any) {
    console.error("API /api/chat/history error:", err?.message || err);

    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}