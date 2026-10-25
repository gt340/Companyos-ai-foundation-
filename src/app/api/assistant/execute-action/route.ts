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

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

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
  if (!approval.valid || !approval.approvalRequestId || !approval.jti) {
    return NextResponse.json(
      { success: false, error: "Action approval is missing, expired, or does not match this exact action. Ask the assistant to propose it again." },
      { status: 403 }
    );
  }

  try {
    const proposed = await prisma.approvalRequest.findFirst({
      where: {
        id: approval.approvalRequestId,
        organizationId: ctx.organizationId,
        requestedBy: ctx.userId,
      },
      select: { id: true, actionType: true, proposedAction: true, status: true },
    });

    if (!proposed ||
        proposed.status !== "PENDING_APPROVAL" ||
        proposed.actionType !== tool ||
        stable(proposed.proposedAction) !== stable({ tool, arguments: args })) {
      return NextResponse.json(
        { success: false, error: "Approval is not pending or does not match this action. Ask the assistant to propose it again." },
        { status: 409 }
      );
    }

    // Atomic one-time claim. Only one concurrent request can transition this
    // exact pending approval to APPROVED and proceed to execution.
    const claim = await prisma.approvalRequest.updateMany({
      where: {
        id: proposed.id,
        organizationId: ctx.organizationId,
        requestedBy: ctx.userId,
        status: "PENDING_APPROVAL",
      },
      data: {
        status: "APPROVED",
        reviewedBy: ctx.userId,
        reason: null,
      },
    });
    if (claim.count !== 1) {
      return NextResponse.json(
        { success: false, error: "This approval has already been claimed or is no longer pending." },
        { status: 409 }
      );
    }

    let result: unknown;
    try {
      result = await executeTool(tool, args, ctx);
    } catch (err) {
      const message = (err as Error).message;
      await prisma.approvalRequest.updateMany({
        where: { id: proposed.id, organizationId: ctx.organizationId, status: "APPROVED" },
        data: { status: "FAILED", reason: message.slice(0, 4000) },
      });
      const isPermissionError = message.startsWith("You don't have permission");
      return NextResponse.json(
        { success: false, error: message },
        { status: isPermissionError ? 403 : 500 }
      );
    }

    await prisma.approvalRequest.updateMany({
      where: { id: proposed.id, organizationId: ctx.organizationId, status: "APPROVED" },
      data: { status: "EXECUTED", result: result as object },
    });

    await prisma.activityLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        category: "SYSTEM",
        action: `assistant.${tool}`,
        metadata: { arguments: args, approvalRequestId: proposed.id, approvalTokenId: approval.jti },
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
