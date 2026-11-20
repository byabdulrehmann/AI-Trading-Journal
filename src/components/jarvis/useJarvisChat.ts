"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/domain/types";
import { api, goToLogin } from "@/lib/client/api";
import { generate, unsupported } from "@/lib/client/browser-model";

export interface UiMessage {
  key: string;
  id?: number;
  role: "user" | "assistant";
  content: string;
  provider?: string | null;
  model?: string | null;
  error?: string;
  streaming?: boolean;
  /** While the in-browser model loads: what it's doing. */
  progress?: string;
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
        // Set when the model runs in this browser: the server sends the instructions instead of a reply.
        let prompt: { system: string; messages: { role: "user" | "assistant"; content: string }[] } | null = null;
        let model: string | null = null;
        let savedIn: number | null = conversationId;
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
              savedIn = data.conversationId;
              model = data.model;
              setMeta(data);
              patch((m) => ({ ...m, provider: data.provider, model: data.model }));
            } else if (event === "prompt") {
              prompt = data;
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
        if (prompt && model && savedIn) await replyInBrowser(prompt, model, savedIn, ctrl.signal, patch);
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

/** Writes the reply with the in-browser model, then saves it to the conversation. */
async function replyInBrowser(
  prompt: { system: string; messages: { role: "user" | "assistant"; content: string }[] },
  model: string,
  conversationId: number,
  signal: AbortSignal,
  patch: (fn: (m: UiMessage) => UiMessage) => void,
) {
  const reason = await unsupported();
  if (reason) throw new Error(`${reason} You can switch to demo mode under Model.`);
  let text = "";
  try {
    const messages = [{ role: "system" as const, content: prompt.system }, ...prompt.messages];
    for await (const piece of generate(model, messages, signal, (progress) => patch((m) => ({ ...m, progress })))) {
      text += piece;
      patch((m) => ({ ...m, progress: undefined, content: m.content + piece }));
    }
  } finally {
    // Keep whatever arrived, including a reply the user stopped part-way, as the server does for other models.
    if (text.trim()) {
      const saved = await api<{ message: ChatMessage }>(`/api/jarvis/conversations/${conversationId}`, {
        method: "POST",
        json: { content: signal.aborted ? `${text}\n\n_(stopped)_` : text, model },
      }).catch(() => null);
      if (saved) patch((m) => ({ ...m, id: saved.message.id }));
    }
  }
  if (signal.aborted) throw new Error("aborted"); // shows "(stopped)" like the other models
}
