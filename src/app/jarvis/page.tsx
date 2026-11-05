"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime } from "@/lib/client/format";
import { MEMORY_KINDS, type Memory } from "@/lib/domain/types";
import { JarvisChat } from "@/components/jarvis/JarvisChat";
import { useJarvisChat } from "@/components/jarvis/useJarvisChat";
import { TradBotConsole } from "@/components/tradbot/TradBotConsole";
import { Badge, Button, EmptyState, Notice, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

interface Conversation { id: number; title: string; createdAt: string; messageCount: number }
interface ProviderInfo {
  id: string; label: string; configured: boolean; external: boolean; reason?: string;
  defaultModel: string; models: { id: string; displayName: string }[]; modelError: string | null;
}
interface ProvidersResponse {
  active: { provider: string; label: string; model: string; fallbackReason: string | null };
  providers: ProviderInfo[];
}

export default function JarvisPage() {
  const { settings, saveSettings } = useApp();
  const [tab, setTab] = useState<"chat" | "tradbot" | "memory" | "model">("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [modelVersion, setModelVersion] = useState(0);
  const chat = useJarvisChat();

  const loadConversations = useCallback(
    () => api<{ conversations: Conversation[] }>("/api/jarvis/conversations").then((r) => setConversations(r.conversations)),
    [],
  );
  useEffect(() => {
    api<{ conversations: Conversation[] }>("/api/jarvis/conversations").then((r) => setConversations(r.conversations));
  }, [chat.conversationId]);

  if (settings && !settings.jarvis.enabled)
    return (
      <>
        <PageHeader title="AI Coach" />
        <EmptyState title="The AI Coach is turned off" body="No conversations are processed while it's off. Your saved conversations and memories are kept until you delete them." action={<Button variant="primary" onClick={() => void saveSettings({ jarvis: { enabled: true } })}>Turn it on</Button>} />
      </>
    );

  return (
    <>
      <PageHeader
        title="AI Coach"
        description="A reflective companion that works from your own records. It doesn't see markets, place trades, or tell you what to trade."
        actions={<Segmented label="AI Coach section" value={tab} onChange={setTab} options={[{ value: "chat", label: "Coach chat" }, { value: "tradbot", label: "TradBot-I live" }, { value: "memory", label: "Memory" }, { value: "model", label: "Model" }]} />}
      />

      {tab === "tradbot" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 border-t border-line lg:grid-cols-[minmax(0,1fr)_17.5rem]">
          <section aria-label="TradBot-I console" className="h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden">
            <TradBotConsole />
          </section>
          <aside className="self-start text-[13px] text-ink-soft lg:pt-3">
            <h2 className="mb-2 text-[14px] font-medium text-ink">Your TradBot-I assistant</h2>
            <p>This is the same assistant as the TradBot-I desktop app: its personality, tools, memory, trading monitor and Gemini Live voice. Jarvis is a remote control for it.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Replies are spoken on the computer running TradBot-I, in the voice chosen in its HUD (Charon, Puck, Kore, Fenrir or Aoede).</li>
              <li>Change voice, audio devices, push-to-talk and trading settings in TradBot-I&apos;s settings drawer.</li>
              <li>It doesn&apos;t see this journal. Its own journal lives in TradBot-I.</li>
              <li>Actions that need confirmation (shutdown, restart, Wi-Fi) still wait for the button in the TradBot-I window.</li>
            </ul>
          </aside>
        </div>
      )}

      {tab === "chat" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-5 border-t border-line lg:grid-cols-[15rem_minmax(0,1fr)]">
          <section aria-label="Conversations" className="self-start">
            <div className="flex items-center justify-between border-b border-line py-1.5">
              <h2 className="text-[13px] font-medium text-ink-soft">Conversations</h2>
              <Button size="sm" variant="ghost" onClick={() => void chat.load(null)}>New</Button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto">
              {conversations.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">None yet</li>}
              {conversations.map((c) => (
                <li key={c.id} className="flex items-center border-b border-line">
                  <button
                    type="button"
                    onClick={() => void chat.load(c.id)}
                    aria-current={chat.conversationId === c.id}
                    className={cx("min-w-0 flex-1 truncate px-2 py-2 text-left text-[13px] pointer-coarse:py-3", chat.conversationId === c.id ? "bg-raised text-ink shadow-[inset_2px_0_0_var(--accent)]" : "text-ink-soft hover:bg-raised hover:text-ink")}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${c.title}`}
                    className="grid h-8 w-8 shrink-0 place-items-center text-muted hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={async () => {
                      await api(`/api/jarvis/conversations/${c.id}`, { method: "DELETE" });
                      if (chat.conversationId === c.id) await chat.load(null);
                      await loadConversations();
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Chat" className="h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden lg:border-l lg:border-line">
            <JarvisChat key={modelVersion} chat={chat} onModelSwitched={() => void loadConversations()} />
          </section>
        </div>
      )}
      {tab === "memory" && <MemoryManager />}
      {tab === "model" && <ModelPicker onSwitched={() => setModelVersion((v) => v + 1)} />}
    </>
  );
}

function ModelPicker({ onSwitched }: { onSwitched: () => void }) {
  const { toast } = useApp();
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<ProvidersResponse>("/api/jarvis/providers").then(setData), []);
  useEffect(() => {
    api<ProvidersResponse>("/api/jarvis/providers").then(setData);
  }, []);

  const choose = async (provider: string, model: string | null) => {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/jarvis/providers", { method: "POST", json: { provider, model } });
      toast({ message: res.message, tone: "success" });
      await load();
      onSwitched();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't switch.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner label="Asking providers which models are available" />;
  return (
    <div>
      <section aria-label="Active model" className="border-t border-line py-4">
        <p className="text-[13px] text-muted">Active now</p>
        <p className="mt-1 text-[16px] font-medium">{data.active.label}, <span className="num">{data.active.model}</span></p>
        {data.active.fallbackReason && <div className="mt-2"><Notice>Demo mode is standing in: {data.active.fallbackReason}</Notice></div>}
        <p className="mt-2 text-[13px] text-muted">You can also type <code className="num">/models</code> or &quot;switch to sonnet&quot; in the chat.</p>
      </section>
      {data.providers.map((p) => (
        <section key={p.id} className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-3 border-t border-line py-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <div>
            <h2 className="text-[15px] font-medium text-ink">{p.label}</h2>
            <p className="mt-0.5 text-[13px] text-muted">{p.external ? "Sends the shared context to this provider over the internet." : "Runs on this computer. No network calls."}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{p.configured ? "Configured" : "Not configured"}</p>
          </div>
          <div className="min-w-0">
            {!p.configured ? (
              <p className="text-[13.5px] text-ink-soft">{p.reason} See the README for setup. Keys stay on the server and are never sent to the browser.</p>
            ) : p.modelError ? (
              <Notice tone="loss">{p.modelError}</Notice>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {p.models.map((m) => {
                  const isActive = data.active.provider === p.id && data.active.model === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={busy || isActive}
                        onClick={() => void choose(p.id, m.id)}
                        aria-current={isActive || undefined}
                        className={cx("flex w-full items-center gap-3 px-2 py-2 text-left transition-colors disabled:cursor-default", isActive ? "bg-raised shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised")}
                      >
                        <span className="min-w-0 flex-1 text-[14px] font-medium">{m.displayName}</span>
                        <span className="min-w-0 truncate text-[12.5px] text-muted"><code className="num">{m.id}</code>{m.id === p.defaultModel ? ", default" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function MemoryManager() {
  const { settings, saveSettings, toast } = useApp();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<Memory["kind"]>("preference");
  const load = useCallback(() => api<{ memories: Memory[] }>("/api/jarvis/memories").then((r) => setMemories(r.memories)), []);
  useEffect(() => {
    api<{ memories: Memory[] }>("/api/jarvis/memories").then((r) => setMemories(r.memories));
  }, []);

  const patch = async (id: number, body: Partial<Memory>) => {
    try {
      await api(`/api/jarvis/memories/${id}`, { method: "PATCH", json: body });
      await load();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't update.", tone: "error" });
    }
  };

  const add = async () => {
    try {
      await api("/api/jarvis/memories", { method: "POST", json: { kind: newKind, content: newText, source: "user" } });
      setNewText("");
      await load();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't save.", tone: "error" });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jarvis-memories.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const memoryOn = settings?.jarvis.memoryEnabled ?? true;

  return (
    <div className="space-y-4">
      <section aria-label="Memory controls" className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <div className="min-w-0 flex-1 text-[13.5px] text-ink-soft">
          The coach only remembers what you save here. Active memories are included with each message; paused ones are kept but not sent.
        </div>
        <Button size="sm" onClick={() => void saveSettings({ jarvis: { memoryEnabled: !memoryOn } })}>{memoryOn ? "Pause all memory" : "Resume memory"}</Button>
        <Button size="sm" onClick={exportJson} disabled={!memories?.length}>Export</Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!memories?.length}
          onClick={async () => {
            if (!confirm("Delete every AI Coach memory? This can't be undone.")) return;
            await api("/api/jarvis/memories", { method: "DELETE" });
            await load();
            toast({ message: "All memories deleted." });
          }}
        >
          Reset
        </Button>
      </section>
      {!memoryOn && <Notice>Memory is paused. Nothing below is sent to the coach.</Notice>}

      <section className="border-t border-line pt-3">
        <h2 className="mb-2 text-[14px] font-medium">Add a memory</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Memory type" className={cx(inputClass, "sm:w-40")} value={newKind} onChange={(e) => setNewKind(e.target.value as Memory["kind"])}>
            {MEMORY_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <label htmlFor="new-memory" className="sr-only">Memory text</label>
          <input id="new-memory" className={inputClass} placeholder="e.g. My rule: no new trades after two losses in a day" value={newText} onChange={(e) => setNewText(e.target.value)} maxLength={500} />
          <Button variant="primary" onClick={add} disabled={newText.trim().length < 3}>Save</Button>
        </div>
      </section>

      {!memories ? (
        <Spinner />
      ) : memories.length === 0 ? (
        <EmptyState title="No memories" body="Save goals, rules or preferences you want the coach to keep in mind, or use “Remember something from this” under a reply." />
      ) : (
        <ul className="border-b border-line">
          {memories.map((m) => (
            <li key={m.id} className="border-t border-line py-3">
              <div className={cx(!m.active && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{m.kind}</Badge>
                  {!m.active && <Badge>paused</Badge>}
                  <span className="text-[12px] text-muted">Saved <span className="num">{dateTime(m.createdAt)}</span>, local time</span>
                  {m.evidenceTradeIds.length > 0 && <span className="text-[12px] text-muted">Linked trades <span className="num">{m.evidenceTradeIds.map((i) => `#${i}`).join(" ")}</span></span>}
                </div>
                {editing === m.id ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <label htmlFor={`edit-${m.id}`} className="sr-only">Edit memory</label>
                    <input id={`edit-${m.id}`} className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} />
                    <Button size="sm" variant="primary" onClick={async () => { await patch(m.id, { content: draft }); setEditing(null); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[14px]">{m.content}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(m.id); setDraft(m.content); }}>Correct</Button>
                  <Button size="sm" variant="ghost" onClick={() => void patch(m.id, { active: !m.active })}>{m.active ? "Pause" : "Resume"}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/api/jarvis/memories/${m.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">
        See <Link href="/settings#privacy" className="underline">Privacy in Settings</Link> for what is shared with model providers.
      </p>
    </div>
  );
}
