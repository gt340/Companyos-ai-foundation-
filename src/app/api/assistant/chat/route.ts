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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_TOOL_ITERATIONS = 5;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

const SYSTEM_PROMPT = `You are the Company Assistant inside CompanyOS AI, embedded in a real organization's workspace. You have tools to look up information (members, activity logs, notifications, organization settings, and the company's knowledge base), tools to take actions (inviting members, updating settings, updating the user's profile, managing knowledge base documents), and a tool to generate images (posters, banners, illustrations).

Always search the knowledge base before answering questions that might be covered by company documents. Read-only tools (including image generation) run automatically. When you want to take an action that changes company data, call the corresponding tool — the system will show the user a confirmation card before anything actually happens, so you do not need to ask permission in words first, just call the tool.`;

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

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...clientMessages.map(
      (m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })
    ),
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
          // generate_image) — execute each and feed results back in.
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
              result = await executeTool(tc.name, parsedArgs, ctx);
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

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
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
