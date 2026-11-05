"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/domain/types";
import { api, goToLogin } from "@/lib/client/api";

export interface UiMessage {
  key: string;
  id?: number;
  role: "user" | "assistant";
  content: string;
  provider?: string | null;
  model?: string | null;
  error?: string;
  streaming?: boolean;
}

export interface ChatMeta {
  provider: string;
  providerLabel?: string;
  model: string | null;
  external?: boolean;
  disclosure: string[];
  notice?: string | null;
}

/**
 * Streams Jarvis replies over fetch + ReadableStream (SSE framing). Runs fully
 * async, so the rest of the app stays interactive; `stop()` aborts the request,
 * which also cancels the provider call on the server.
 */
export function useJarvisChat(onModelSwitched?: () => void) {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const keyRef = useRef(0);
  const nextKey = () => `m${++keyRef.current}`;

  // Only a real unmount cancels: React's dev double-mount would otherwise stop a request sent as the panel opens.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) abortRef.current?.abort();
      });
    };
  }, []);

  const load = useCallback(async (id: number | null) => {
    abortRef.current?.abort();
    setConversationId(id);
    setMeta(null);
    if (!id) return setMessages([]);
    const res = await api<{ messages: ChatMessage[] }>(`/api/jarvis/conversations/${id}`);
    setMessages(res.messages.map((m) => ({ key: `db${m.id}`, id: m.id, role: m.role, content: m.content, provider: m.provider, model: m.model })));
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, focusTradeId: number | null = null) => {
      const message = text.trim();
      if (!message || busy) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      const assistantKey = nextKey();
      setMessages((ms) => [...ms, { key: nextKey(), role: "user", content: message }, { key: assistantKey, role: "assistant", content: "", streaming: true }]);
      const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.key === assistantKey ? fn(m) : m)));

      try {
        const res = await fetch("/api/jarvis/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message, focusTradeId }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) goToLogin();
          throw new Error(data.error ?? `The AI Coach is unavailable (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            const dataLine = /^data: (.+)$/m.exec(frame)?.[1];
            if (!event || !dataLine) continue;
            const data = JSON.parse(dataLine);
            if (event === "meta") {
              setConversationId(data.conversationId);
              setMeta(data);
              patch((m) => ({ ...m, provider: data.provider, model: data.model }));
            } else if (event === "delta") {
              patch((m) => ({ ...m, content: m.content + data.text }));
            } else if (event === "error") {
              // Provider failed; a demo reply may follow in the same stream.
              patch((m) => ({ ...m, error: data.message + (data.fallback ? " Showing a demo-mode reply instead." : ""), content: data.fallback ? "" : m.content }));
            } else if (event === "done") {
              patch((m) => ({ ...m, id: data.messageId }));
              if (data.switched) onModelSwitched?.();
            }
          }
        }
      } catch (err) {
        if (ctrl.signal.aborted) patch((m) => ({ ...m, content: m.content ? `${m.content}\n\n_(stopped)_` : "_(stopped)_" }));
        else patch((m) => ({ ...m, error: err instanceof Error ? err.message : "Something went wrong." }));
      } finally {
        patch((m) => ({ ...m, streaming: false }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, conversationId, onModelSwitched],
  );

  return { conversationId, messages, busy, meta, send, stop, load };
}
