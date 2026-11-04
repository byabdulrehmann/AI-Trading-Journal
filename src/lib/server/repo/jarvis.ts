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

export function listMemories(userId: number, onlyActive = false): Memory[] {
  const rows = db()
    .prepare(`SELECT * FROM jarvis_memories WHERE user_id = ? ${onlyActive ? "AND active = 1" : ""} ORDER BY id DESC`)
    .all(userId) as Row[];
  return rows.map(toMemory);
}

export function createMemory(userId: number, input: MemoryInput): Memory {
  const m = MemorySchema.parse(input);
  const ts = now();
  const res = db()
    .prepare("INSERT INTO jarvis_memories (user_id, kind, content, source, evidence_trade_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(userId, m.kind, m.content, m.source, JSON.stringify(m.evidenceTradeIds), ts, ts);
  return toMemory(db().prepare("SELECT * FROM jarvis_memories WHERE id = ?").get(Number(res.lastInsertRowid)) as Row);
}

export function updateMemory(userId: number, id: number, patch: { content?: string; kind?: Memory["kind"]; active?: boolean }): Memory | null {
  const cur = db().prepare("SELECT * FROM jarvis_memories WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!cur) return null;
  const m = toMemory(cur);
  const next = MemorySchema.parse({ ...m, ...patch });
  db()
    .prepare("UPDATE jarvis_memories SET kind = ?, content = ?, active = ?, updated_at = ? WHERE id = ?")
    .run(next.kind, next.content, (patch.active ?? m.active) ? 1 : 0, now(), id);
  return toMemory(db().prepare("SELECT * FROM jarvis_memories WHERE id = ?").get(id) as Row);
}

export function deleteMemory(userId: number, id: number): boolean {
  return db().prepare("DELETE FROM jarvis_memories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function resetMemories(userId: number): number {
  return Number(db().prepare("DELETE FROM jarvis_memories WHERE user_id = ?").run(userId).changes);
}

// ---------- conversations ----------

export interface Conversation {
  id: number;
  title: string;
  createdAt: string;
  messageCount: number;
}

export function listConversations(userId: number): Conversation[] {
  const rows = db()
    .prepare(
      `SELECT c.id, c.title, c.created_at, COUNT(m.id) AS n
       FROM jarvis_conversations c LEFT JOIN jarvis_messages m ON m.conversation_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id ORDER BY c.id DESC`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({ id: r.id as number, title: r.title as string, createdAt: r.created_at as string, messageCount: r.n as number }));
}

export function createConversation(userId: number, title: string): number {
  const res = db().prepare("INSERT INTO jarvis_conversations (user_id, title, created_at) VALUES (?, ?, ?)").run(userId, title.slice(0, 80), now());
  return Number(res.lastInsertRowid);
}

export function conversationExists(userId: number, id: number): boolean {
  return Boolean(db().prepare("SELECT 1 FROM jarvis_conversations WHERE id = ? AND user_id = ?").get(id, userId));
}

export function deleteConversation(userId: number, id: number): boolean {
  return db().prepare("DELETE FROM jarvis_conversations WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function deleteAllConversations(userId: number): number {
  return Number(db().prepare("DELETE FROM jarvis_conversations WHERE user_id = ?").run(userId).changes);
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
