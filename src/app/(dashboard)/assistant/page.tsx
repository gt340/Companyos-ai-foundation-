// src/app/(dashboard)/assistant/page.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Check, X, Mic, MicOff } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}

interface PendingAction {
  tool: string;
  arguments: Record<string, unknown>;
}

function describeAction(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "invite_member":
      return `Invite ${args.email} as ${args.role}`;
    case "update_organization_name":
      return `Update organization${args.name ? ` name to "${args.name}"` : ""}${
        args.slug ? `, slug to "${args.slug}"` : ""
      }`;
    case "update_security_settings":
      return `Set "require 2FA for all members" to ${String(args.require2FA)}`;
    case "update_notification_settings":
      return "Update organization notification settings";
    case "update_profile":
      return `Update your display name to "${args.name}"`;
    case "create_knowledge_document":
      return `Add "${args.url}" to the knowledge base`;
    case "create_document_draft":
      return `Create document "${args.title}" (${args.category})`;
    case "update_document_content":
      return `Update document ${args.documentId} with new content`;
    case "delete_knowledge_document":
      return `Delete knowledge base document ${args.documentId}`;
    default:
      return `Run ${tool}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = any;

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, pendingAction]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setMicSupported(false);
      return;
    }

    const recognition: SpeechRecognitionType = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionType) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  function toggleMic() {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInput("");
      recognitionRef.current.start();
      setIsListening(true);
    }
  }

  async function sendMessage(history: ChatMessage[]) {
    setIsLoading(true);
    setStreamingText("");
    setStatusLine(null);
    setPendingAction(null);

    let assistantText = "";

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}. Please try again.`);
      }

      if (!res.body) {
        throw new Error("No response received. Please try again.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let event: any;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          switch (event.type) {
            case "text":
              assistantText += event.content;
              setStreamingText(assistantText);
              break;
            case "tool_call":
              setStatusLine(
                event.name === "generate_image"
                  ? "Generating image…"
                  : `Looking up ${formatToolLabel(event.name)}…`
              );
              break;
            case "tool_result":
              setStatusLine(null);
              if (event.name === "generate_image" && event.result?.url) {
                if (assistantText) {
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: assistantText },
                  ]);
                  assistantText = "";
                  setStreamingText("");
                }
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: "", imageUrl: event.result.url },
                ]);
              }
              break;
            case "tool_error":
              setStatusLine(`Couldn't complete ${formatToolLabel(event.name)}`);
              break;
            case "action_proposal":
              setPendingAction({ tool: event.tool, arguments: event.arguments });
              break;
            case "error":
              assistantText +=
                (assistantText ? "\n\n" : "") + `Error: ${event.message}`;
              setStreamingText(assistantText);
              break;
            case "done":
              break;
          }
        }
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Check your connection and try again.";
      assistantText = assistantText || `⚠️ Connection issue: ${message}`;
    } finally {
      setIsLoading(false);
      setStatusLine(null);
      if (assistantText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: assistantText },
        ]);
        setStreamingText("");
      }
    }
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextHistory);
    setInput("");
    sendMessage(nextHistory);
  }

  async function handleConfirm() {
    if (!pendingAction) return;
    setConfirming(true);

    try {
      const res = await fetch("/api/assistant/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingAction),
      });
      const data = await res.json();

      const summary = describeAction(
        pendingAction.tool,
        pendingAction.arguments
      );

      const note: ChatMessage = {
        role: "assistant",
        content: data.success
          ? `✅ Done: ${summary}`
          : `❌ Couldn't complete "${summary}": ${data.error}`,
      };

      setMessages((prev) => [...prev, note]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "❌ Couldn't reach the server to run that action. Check your connection and try again.",
        },
      ]);
    } finally {
      setPendingAction(null);
      setConfirming(false);
    }
  }

  function handleCancel() {
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Action cancelled." },
    ]);
    setPendingAction(null);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-2xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && !streamingText && (
          <p className="text-muted-foreground text-sm text-center mt-12">
            Ask me about your organization, members, activity, or company
            knowledge base — or ask me to make a change.
          </p>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.imageUrl ? (
              <img
                src={m.imageUrl}
                alt="Generated"
                className="rounded-lg max-w-[85%] border"
              />
            ) : (
              <div
                className={`rounded-lg px-4 py-2 max-w-[85%] whitespace-pre-wrap text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {m.content}
              </div>
            )}
          </div>
        ))}

        {streamingText && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 max-w-[85%] whitespace-pre-wrap text-sm bg-muted">
              {streamingText}
            </div>
          </div>
        )}

        {statusLine && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {statusLine}
          </div>
        )}

        {pendingAction && (
          <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <p className="text-sm font-medium mb-3">
              {describeAction(pendingAction.tool, pendingAction.arguments)}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConfirm} disabled={confirming}>
                {confirming ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={confirming}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </Card>
        )}

        <div ref={scrollRef} />
      </div>

      {isListening && (
        <div className="px-4 pb-1 flex items-center gap-2 text-xs text-red-500">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Listening…
        </div>
      )}

      <div className="border-t p-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask the assistant…"
          disabled={isLoading || !!pendingAction}
        />
        {micSupported && (
          <Button
            type="button"
            variant={isListening ? "destructive" : "outline"}
            onClick={toggleMic}
            disabled={isLoading || !!pendingAction}
            title={isListening ? "Stop listening" : "Speak your message"}
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          onClick={handleSend}
          disabled={isLoading || !!pendingAction || !input.trim()}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function formatToolLabel(name: string): string {
  return name.replace(/_/g, " ");
}
