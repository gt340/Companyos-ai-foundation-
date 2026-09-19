// src/app/api/assistant/chat/route.ts

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  ALL_TOOL_DEFINITIONS,
  READ_ONLY_TOOL_NAMES,
} from "@/lib/assistant/tools";
import {
  buildExecutorContext,
  executeTool,
} from "@/lib/assistant/tool-executors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_TOOL_ITERATIONS = 5;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
  imageDataUrl?: string;
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function toChatMessage(m: ClientMessage): ChatCompletionMessageParam {
  if (m.role === "user" && m.imageDataUrl) {
    return {
      role: "user",
      content: [
        { type: "text", text: m.content },
        { type: "image_url", image_url: { url: m.imageDataUrl } },
      ],
    };
  }
  return { role: m.role, content: m.content };
}

const SYSTEM_PROMPT = `You are the CEO Agent for this organization inside CompanyOS AI — an executive-level AI embedded in the company's workspace, not just a general assistant. You think and communicate the way a sharp, honest chief of staff would: direct, grounded in real data, and clear about what you don't know.

You have tools to look up information (members, activity logs, notifications, organization settings, and the company's knowledge base), tools to take actions (inviting members, changing a member's role, updating settings, updating the user's profile, managing knowledge base documents), a tool to generate new images (posters, banners, illustrations), and a tool to edit an image the user has attached to their current message.

You also have search_web, which searches the live internet — use it when the user asks you to search online, research something, or look something up externally (market trends, competitor information, industry news, general facts). This is separate from search_knowledge_base, which only searches documents already added to this company's own knowledge base. If a web search turns up something worth keeping permanently, you can add it to the knowledge base with create_knowledge_document (if it's a specific URL worth ingesting fully) or save a summary of it with remember_ceo_insight (for a fact worth remembering going forward). Never present something found via search_web as if it were the company's own verified data — attribute it as external information.

You also have executive-level capabilities specific to your role as CEO Agent:
- Persistent memory: use remember_ceo_insight to save durable facts, decisions, strategic goals, or founder preferences that should carry forward into future conversations — not passing chit-chat, but things worth remembering long-term. Use list_ceo_memories to recall what you already know before answering strategic questions, so you build on prior context instead of repeating yourself.
- Executive reporting: use generate_executive_report for a broad company-status report, generate_strategic_plan when the founder wants strategic or planning help, or generate_risk_analysis when they want risks identified. All three accept an optional focusArea to narrow the report to a specific topic the user asked about (e.g. "our hiring plans"), and an optional title and reportingPeriod. Every report section must be clearly grounded — distinguish FACT (something directly known, e.g. from the company profile or knowledge base), ANALYSIS (your reasoning connecting facts), INSIGHT (a non-obvious observation), RECOMMENDATION (a suggested action), and DATA GAP (something you cannot assess because the relevant data isn't connected). Use list_executive_reports and get_executive_report to reference past reports (of any of these three kinds) rather than regenerating from scratch when the user asks to see or discuss one that already exists.
- Strict anti-fabrication rule: you have no live connection to sales, financial, or KPI data. Never invent or estimate numbers for these. If asked about them, say plainly that this data isn't connected yet rather than guessing or approximating.

The user may attach an image directly to their message — you can see it and reference it naturally (e.g. "based on the poster you attached..."). If they ask you to edit, modify, or change that attached image, use the edit_image tool. The user may also attach a document — its extracted text will appear inline in their message, clearly marked.

Always search the knowledge base before answering questions that might be covered by company documents. Read-only tools (including image generation and editing, and the CEO tools above) run automatically. When you want to take an action that changes company data, call the corresponding tool — the system will show the user a confirmation card before anything actually happens, so you do not need to ask permission in words first, just call the tool.

Do not use Markdown formatting (no **bold**, no # headers, no bullet points with - or *). Write in plain text only, since your replies are displayed as-is without any formatting applied. For lists, just use numbered lines like "1. Item" on separate lines.`;

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await buildExecutorContext();
  } catch (err) {
    return new Response(
      encodeEvent({ type: "error", message: (err as Error).message }),
      { status: 401 }
    );
  }

  const { messages: clientMessages } = (await req.json()) as {
    messages: ClientMessage[];
  };

  // If the user's latest message includes an attached image, make it
  // available to tool executors for this turn only (used by edit_image).
  const latestUserMessage = [...clientMessages]
    .reverse()
    .find((m) => m.role === "user");
  const attachedImageDataUrl = latestUserMessage?.imageDataUrl;
  const ctxForTools = attachedImageDataUrl
    ? { ...ctx, attachedImageDataUrl }
    : ctx;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...clientMessages.map(toChatMessage),
  ];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let iterations = 0;

        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++;

          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools: ALL_TOOL_DEFINITIONS,
            tool_choice: "auto",
            stream: true,
          });

          let assistantText = "";
          let finishReason: string | null = null;

          const toolCallAccum: Record<
            number,
            { id: string; name: string; args: string }
          > = {};

          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta;
            const reason = chunk.choices[0]?.finish_reason;
            if (reason) finishReason = reason;

            if (delta?.content) {
              assistantText += delta.content;
              controller.enqueue(
                encodeEvent({ type: "text", content: delta.content })
              );
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallAccum[idx]) {
                  toolCallAccum[idx] = { id: "", name: "", args: "" };
                }
                if (tc.id) toolCallAccum[idx].id = tc.id;
                if (tc.function?.name)
                  toolCallAccum[idx].name += tc.function.name;
                if (tc.function?.arguments)
                  toolCallAccum[idx].args += tc.function.arguments;
              }
            }
          }

          const toolCalls = Object.values(toolCallAccum);

          if (toolCalls.length === 0 || finishReason !== "tool_calls") {
            controller.enqueue(encodeEvent({ type: "done" }));
            controller.close();
            return;
          }

          messages.push({
            role: "assistant",
            content: assistantText || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.args },
            })),
          });

          const mutatingCall = toolCalls.find(
            (tc) => !READ_ONLY_TOOL_NAMES.includes(tc.name)
          );

          if (mutatingCall) {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(mutatingCall.args || "{}");
            } catch {
              // leave as empty object if the model produced malformed JSON
            }
            controller.enqueue(
              encodeEvent({
                type: "action_proposal",
                tool: mutatingCall.name,
                arguments: parsedArgs,
              })
            );
            controller.enqueue(encodeEvent({ type: "done" }));
            controller.close();
            return;
          }

          // All calls in this batch are read-only (this includes
          // generate_image / edit_image) — execute each and feed results
          // back in.
          for (const tc of toolCalls) {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(tc.args || "{}");
            } catch {
              // malformed args from the model — pass through empty
            }

            controller.enqueue(
              encodeEvent({ type: "tool_call", name: tc.name, args: parsedArgs })
            );

            let result: unknown;
            let toolError: string | null = null;
            try {
              result = await executeTool(tc.name, parsedArgs, ctxForTools);
            } catch (err) {
              toolError = (err as Error).message;
              result = { error: toolError };
            }

            if (toolError) {
              controller.enqueue(
                encodeEvent({ type: "tool_error", name: tc.name, message: toolError })
              );
            } else {
              controller.enqueue(
                encodeEvent({ type: "tool_result", name: tc.name, result })
              );
            }

            // The client already received the full result (including any
            // image data URL) via the tool_result event above. What goes
            // back into the model's own conversation history must stay
            // small — a generated/edited image's base64 payload can be
            // hundreds of thousands of characters, which blows past the
            // per-minute token rate limit on the very next call. So for
            // image tools specifically, only tell the model that it
            // worked (plus the revised prompt), never the actual image
            // data.
            const isImageResult =
              (tc.name === "generate_image" || tc.name === "edit_image") &&
              result &&
              typeof result === "object" &&
              "url" in (result as Record<string, unknown>);

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: isImageResult
                ? JSON.stringify({
                    generated: true,
                    revisedPrompt:
                      (result as { revisedPrompt?: string }).revisedPrompt ?? null,
                  })
                : JSON.stringify(result),
            });
          }
          // loop continues — next iteration re-calls OpenAI with tool results in context
        }

        controller.enqueue(
          encodeEvent({
            type: "error",
            message: "Reached maximum tool iterations without a final answer.",
          })
        );
        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encodeEvent({ type: "error", message: (err as Error).message })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
