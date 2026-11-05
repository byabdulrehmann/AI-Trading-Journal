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
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

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
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card className="h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden">
            <TradBotConsole />
          </Card>
          <Card className="self-start p-4 text-[13px] text-ink-soft">
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Your TradBot-I assistant</h2>
            <p>This is the same assistant as the TradBot-I desktop app: its personality, tools, memory, trading monitor and Gemini Live voice. Jarvis is a remote control for it.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Replies are spoken on the computer running TradBot-I, in the voice chosen in its HUD (Charon, Puck, Kore, Fenrir or Aoede).</li>
              <li>Change voice, audio devices, push-to-talk and trading settings in TradBot-I&apos;s ⚙ drawer.</li>
              <li>It doesn&apos;t see this journal. Its own journal lives in TradBot-I.</li>
              <li>Actions that need confirmation (shutdown, restart, Wi-Fi) still wait for the button in the TradBot-I window.</li>
            </ul>
          </Card>
        </div>
      )}

      {tab === "chat" && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="self-start">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <h2 className="text-[13px] font-semibold text-ink-soft">Conversations</h2>
              <Button size="sm" variant="ghost" onClick={() => void chat.load(null)}>New</Button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {conversations.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">None yet</li>}
              {conversations.map((c) => (
                <li key={c.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => void chat.load(c.id)}
                    aria-current={chat.conversationId === c.id}
                    className={cx("min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px]", chat.conversationId === c.id ? "bg-raised text-ink" : "text-ink-soft hover:text-ink")}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${c.title}`}
                    className="px-2 text-muted opacity-60 hover:text-loss group-hover:opacity-100"
                    onClick={async () => {
                      await api(`/api/jarvis/conversations/${c.id}`, { method: "DELETE" });
                      if (chat.conversationId === c.id) await chat.load(null);
                      await loadConversations();
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden">
            <JarvisChat key={modelVersion} chat={chat} onModelSwitched={() => void loadConversations()} />
          </Card>
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
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-[13px] text-muted">Active now</p>
        <p className="mt-1 text-[16px] font-semibold">{data.active.label}, <span className="num">{data.active.model}</span></p>
        {data.active.fallbackReason && <p className="mt-2 text-[13px] text-accent">Demo mode is standing in: {data.active.fallbackReason}</p>}
        <p className="mt-2 text-[13px] text-muted">You can also type <code className="num">/models</code> or &quot;switch to sonnet&quot; in the chat.</p>
      </Card>
      {data.providers.map((p) => (
        <Card key={p.id}>
          <CardHeader
            title={p.label}
            subtitle={p.external ? "Sends the shared context to this provider over the internet." : "Runs on this computer. No network calls."}
            action={p.configured ? <Badge tone="profit">Configured</Badge> : <Badge tone="loss">Not configured</Badge>}
          />
          <div className="p-5">
            {!p.configured ? (
              <p className="text-[13.5px] text-ink-soft">{p.reason} See the README for setup. Keys stay on the server and are never sent to the browser.</p>
            ) : p.modelError ? (
              <p className="text-[13.5px] text-loss">{p.modelError}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {p.models.map((m) => {
                  const isActive = data.active.provider === p.id && data.active.model === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={busy || isActive}
                        onClick={() => void choose(p.id, m.id)}
                        className={cx("w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default", isActive ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
                      >
                        <span className="block text-[14px] font-medium">{m.displayName}</span>
                        <span className="num block text-[12px] text-muted">{m.id}{m.id === p.defaultModel ? ", default" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
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
      <Card className="flex flex-wrap items-center gap-3 p-4">
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
      </Card>
      {!memoryOn && <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">Memory is paused. Nothing below is sent to the coach.</p>}

      <Card className="p-4">
        <h2 className="mb-2 text-[14px] font-semibold">Add a memory</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Memory type" className={cx(inputClass, "sm:w-40")} value={newKind} onChange={(e) => setNewKind(e.target.value as Memory["kind"])}>
            {MEMORY_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <label htmlFor="new-memory" className="sr-only">Memory text</label>
          <input id="new-memory" className={inputClass} placeholder="e.g. My rule: no new trades after two losses in a day" value={newText} onChange={(e) => setNewText(e.target.value)} maxLength={500} />
          <Button variant="primary" onClick={add} disabled={newText.trim().length < 3}>Save</Button>
        </div>
      </Card>

      {!memories ? (
        <Spinner />
      ) : memories.length === 0 ? (
        <EmptyState title="No memories" body="Save goals, rules or preferences you want the coach to keep in mind, or use “Remember something from this” under a reply." />
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li key={m.id}>
              <Card className={cx("p-4", !m.active && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{m.kind}</Badge>
                  {!m.active && <Badge>paused</Badge>}
                  <span className="text-[12px] text-muted">Saved {dateTime(m.createdAt)}</span>
                  {m.evidenceTradeIds.length > 0 && <span className="text-[12px] text-muted">Linked trades {m.evidenceTradeIds.map((i) => `#${i}`).join(" ")}</span>}
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
                    className="text-loss"
                    onClick={async () => {
                      await api(`/api/jarvis/memories/${m.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
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
