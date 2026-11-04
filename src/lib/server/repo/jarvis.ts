import "server-only";
import { db, now } from "../db";
import type { ChatMessage, Memory, MemoryInput } from "@/lib/domain/types";
import { MemoryInput as MemorySchema } from "@/lib/domain/types";

type Row = Record<string, unknown>;

// ---------- memories ----------

function toMemory(r: Row): Memory {
  return {
    id: r.id as number,
    kind: r.kind as Memory["kind"],
    content: r.content as string,
    source: r.source as Memory["source"],
    evidenceTradeIds: JSON.parse(r.evidence_trade_ids as string),
    active: r.active === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listMemories(onlyActive = false): Memory[] {
  const rows = db()
    .prepare(`SELECT * FROM jarvis_memories ${onlyActive ? "WHERE active = 1" : ""} ORDER BY id DESC`)
    .all() as Row[];
  return rows.map(toMemory);
}

export function createMemory(input: MemoryInput): Memory {
  const m = MemorySchema.parse(input);
  const ts = now();
  const res = db()
    .prepare("INSERT INTO jarvis_memories (kind, content, source, evidence_trade_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(m.kind, m.content, m.source, JSON.stringify(m.evidenceTradeIds), ts, ts);
  return toMemory(db().prepare("SELECT * FROM jarvis_memories WHERE id = ?").get(Number(res.lastInsertRowid)) as Row);
}

export function updateMemory(id: number, patch: { content?: string; kind?: Memory["kind"]; active?: boolean }): Memory | null {
  const cur = db().prepare("SELECT * FROM jarvis_memories WHERE id = ?").get(id) as Row | undefined;
  if (!cur) return null;
  const m = toMemory(cur);
  const next = MemorySchema.parse({ ...m, ...patch });
  db()
    .prepare("UPDATE jarvis_memories SET kind = ?, content = ?, active = ?, updated_at = ? WHERE id = ?")
    .run(next.kind, next.content, (patch.active ?? m.active) ? 1 : 0, now(), id);
  return toMemory(db().prepare("SELECT * FROM jarvis_memories WHERE id = ?").get(id) as Row);
}

export function deleteMemory(id: number): boolean {
  return db().prepare("DELETE FROM jarvis_memories WHERE id = ?").run(id).changes > 0;
}

export function resetMemories(): number {
  return Number(db().prepare("DELETE FROM jarvis_memories").run().changes);
}

// ---------- conversations ----------

export interface Conversation {
  id: number;
  title: string;
  createdAt: string;
  messageCount: number;
}

export function listConversations(): Conversation[] {
  const rows = db()
    .prepare(
      `SELECT c.id, c.title, c.created_at, COUNT(m.id) AS n
       FROM jarvis_conversations c LEFT JOIN jarvis_messages m ON m.conversation_id = c.id
       GROUP BY c.id ORDER BY c.id DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({ id: r.id as number, title: r.title as string, createdAt: r.created_at as string, messageCount: r.n as number }));
}

export function createConversation(title: string): number {
  const res = db().prepare("INSERT INTO jarvis_conversations (title, created_at) VALUES (?, ?)").run(title.slice(0, 80), now());
  return Number(res.lastInsertRowid);
}

export function conversationExists(id: number): boolean {
  return Boolean(db().prepare("SELECT 1 FROM jarvis_conversations WHERE id = ?").get(id));
}

export function deleteConversation(id: number): boolean {
  return db().prepare("DELETE FROM jarvis_conversations WHERE id = ?").run(id).changes > 0;
}

export function deleteAllConversations(): number {
  return Number(db().prepare("DELETE FROM jarvis_conversations").run().changes);
}

function toMessage(r: Row): ChatMessage {
  return {
    id: r.id as number,
    conversationId: r.conversation_id as number,
    role: r.role as ChatMessage["role"],
    content: r.content as string,
    provider: (r.provider as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listMessages(conversationId: number, limit?: number): ChatMessage[] {
  const rows = (
    limit
      ? db()
          .prepare("SELECT * FROM (SELECT * FROM jarvis_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id")
          .all(conversationId, limit)
      : db().prepare("SELECT * FROM jarvis_messages WHERE conversation_id = ? ORDER BY id").all(conversationId)
  ) as Row[];
  return rows.map(toMessage);
}

export function addMessage(
  conversationId: number,
  role: ChatMessage["role"],
  content: string,
  provider: string | null = null,
  model: string | null = null,
): ChatMessage {
  const res = db()
    .prepare("INSERT INTO jarvis_messages (conversation_id, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(conversationId, role, content, provider, model, now());
  return toMessage(db().prepare("SELECT * FROM jarvis_messages WHERE id = ?").get(Number(res.lastInsertRowid)) as Row);
}
