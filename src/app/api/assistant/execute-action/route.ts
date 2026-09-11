// src/app/api/assistant/execute-action/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MUTATING_TOOL_NAMES } from "@/lib/assistant/tools";
import {
  buildExecutorContext,
  executeTool,
} from "@/lib/assistant/tool-executors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await buildExecutorContext();
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const tool = body?.tool as string | undefined;
  const args = body?.arguments ?? {};

  if (!tool) {
    return NextResponse.json(
      { success: false, error: "Missing 'tool' in request body." },
      { status: 400 }
    );
  }

  // Safety check: this endpoint only ever runs actions the user has
  // explicitly confirmed, and only mutating tools — read-only tools
  // should never reach here (they already auto-execute in the chat route).
  if (!MUTATING_TOOL_NAMES.includes(tool)) {
    return NextResponse.json(
      { success: false, error: `'${tool}' is not a confirmable action.` },
      { status: 400 }
    );
  }

  try {
    const result = await executeTool(tool, args, ctx);

    // Audit trail: record that the assistant performed this action.
    await prisma.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        category: "SYSTEM",
        action: `assistant.${tool}`,
        metadata: { arguments: args },
      },
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = (err as Error).message;
    const isPermissionError = message.startsWith("You don't have permission");
    return NextResponse.json(
      { success: false, error: message },
      { status: isPermissionError ? 403 : 500 }
    );
  }
      }
