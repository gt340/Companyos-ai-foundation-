// src/app/api/assistant/execute-action/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MUTATING_TOOL_NAMES } from "@/lib/assistant/tools";
import { verifyActionApprovalToken } from "@/lib/assistant/action-approval";
import {
  buildExecutorContext,
  executeTool,
} from "@/lib/assistant/tool-executors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const approvalToken = body?.approvalToken;

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

  const approval = verifyActionApprovalToken({
    token: approvalToken,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    tool,
    args,
  });
  if (!approval.valid) {
    return NextResponse.json(
      { success: false, error: "Action approval is missing, expired, or does not match this exact action. Ask the assistant to propose it again." },
      { status: 403 }
    );
  }

  try {
    // Best-effort replay guard: refuse a token already recorded in the audit log.
    // The action token is also short-lived and bound to the exact user/org/tool/arguments.
    const priorUse = await prisma.activityLog.findFirst({
      where: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: `assistant.${tool}`,
        metadata: { path: ["approvalTokenId"], equals: approval.jti },
      },
      select: { id: true },
    });
    if (priorUse) {
      return NextResponse.json(
        { success: false, error: "This approval has already been used. Ask the assistant to propose the action again." },
        { status: 409 }
      );
    }

    const result = await executeTool(tool, args, ctx);

    // Audit trail: record that the assistant performed this action.
    await prisma.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        category: "SYSTEM",
        action: `assistant.${tool}`,
        metadata: { arguments: args, approvalTokenId: approval.jti },
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
