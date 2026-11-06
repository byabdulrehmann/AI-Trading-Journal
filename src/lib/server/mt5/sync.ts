import "server-only";
import { db, now, transaction } from "../db";
import { audit } from "../repo/audit";
import { createAccount } from "../repo/journal";
import { applyPayload, clearConnection, findAccountId, finishJob, needsFullHistory, priorRefusals, readForSync, recordFailure, saveConnection, startJob } from "../repo/mt5";
import { runSession, stopService, type SessionCategory, type SessionPayload, type SessionResult } from "./client";
import { decrypt, encrypt } from "./crypto";

const HISTORY_START = 946684800; // 2000-01-01: "everything".
// Deal times may carry the broker's offset, and a late-booked deal shouldn't be missed.
const OVERLAP_SECONDS = 3 * 86400;
// MT5 gives one code for a wrong password and for a broker that is briefly refusing logins (seen: "Service is not available"),
// so a connection that has worked only stops after this many refusals in a row. Few enough not to lock an account.
const REFUSALS_TO_STOP = 3;
const REFUSED_WILL_RETRY = "MT5 refused the login. This also happens during a short broker outage, so Jarvis will try again. If you changed the investor password, disconnect and connect again.";

const g = globalThis as unknown as { __jarvisMt5Syncing?: Set<number> };
/** Accounts with a sync running now. In memory, so a crash can't leave one stuck as "syncing". */
export const syncing = (g.__jarvisMt5Syncing ??= new Set<number>());

/** Fixed wording per category, so nothing the terminal or service said can carry a password out. */
export function errorText(category: SessionCategory, code?: number | null): string {
  switch (category) {
    case "wrong_password":
      return "MT5 refused the login. Check the account number and investor password. Automatic sync stops until you reconnect, so a wrong password can't lock the account.";
    case "invalid_server":
      return "Could not reach that server. Check the server name exactly as MT5 shows it. This also happens when the broker or your internet is down.";
    case "terminal_missing":
      return "The dedicated MT5 terminal isn't set up. Run: node scripts/setup-mt5.mjs";
    case "no_connection":
      return "The dedicated MT5 terminal didn't respond. Its first start can take a few minutes, so try again shortly.";
    case "timeout":
      return "MT5 took too long to answer, so the sync was stopped. It will try again.";
    default:
      return `MT5 reported an error${code ? ` (code ${code})` : ""}. It will try again.`;
  }
}

export type ConnectResult = { ok: true; accountId: number } | { ok: false; category: SessionCategory; error: string };

function fromFor(accountId: number): number {
  const row = readForSync(accountId);
  if (!row?.history_synced_to || needsFullHistory(accountId)) return HISTORY_START;
  return Math.max(HISTORY_START, Math.floor(Date.parse(row.history_synced_to) / 1000) - OVERLAP_SECONDS);
}

/** Nothing is stored until the broker has accepted the login. */
export async function connectAccount(userId: number, login: number, server: string, password: string): Promise<ConnectResult> {
  const existing = findAccountId(userId, String(login), server);
  const at = now();
  const result = await runSession({ login, server, password, from: existing ? fromFor(existing) : HISTORY_START });
  if (!result.ok) return { ok: false, category: result.category, error: errorText(result.category, result.code) };

  const cipher = encrypt(password);
  const { account } = result.payload;
  const accountId = transaction(db(), () => {
    const id = existing ?? createAccount(userId, { name: `${account.company || server} ${login}`, broker: account.company ?? "", currency: account.currency, startingBalance: 0 }, { source: "mt5" }).id;
    saveConnection(id, String(login), server, cipher);
    const job = startJob(id, at);
    const applied = applyPayload(userId, id, result.payload, at);
    finishJob(job, id, "ok", applied, applied.note);
    audit(userId, "mt5.connected", "account", id);
    return id;
  });
  return { ok: true, accountId };
}

export type SyncOutcome = { ok: true } | { ok: false; category: SessionCategory | "busy" | "not_connected"; error: string };

/** Runs one sync for an account. Failures are recorded on the connection, and old data is left in place. */
export async function syncAccount(accountId: number): Promise<SyncOutcome> {
  if (syncing.has(accountId)) return { ok: false, category: "busy", error: "A sync is already running." };
  const row = readForSync(accountId);
  if (!row?.password_cipher) return { ok: false, category: "not_connected", error: "This account isn't connected." };

  syncing.add(accountId);
  const at = now();
  const job = startJob(accountId, at);
  const failed = (category: SessionCategory, error: string): SyncOutcome => {
    const stop = errorText("wrong_password");
    const refused = category === "wrong_password";
    const stopping = refused && priorRefusals(accountId, job, [REFUSED_WILL_RETRY, stop]) + 1 >= REFUSALS_TO_STOP;
    const text = refused && !stopping ? REFUSED_WILL_RETRY : error;
    recordFailure(accountId, at, text, stopping);
    finishJob(job, accountId, "failed", {}, text);
    return { ok: false, category, error: text };
  };
  try {
    let password: string;
    try {
      password = decrypt(row.password_cipher);
    } catch {
      return failed("other", "The stored password can't be read, perhaps because the key changed. Disconnect and connect again.");
    }
    const result: SessionResult = await runSession({ login: Number(row.login), server: row.server, password, from: fromFor(accountId) });
    if (!result.ok) return failed(result.category, errorText(result.category, result.code));

    // Disconnected while the terminal was working: the answer is no longer wanted.
    if (!readForSync(accountId)?.password_cipher) {
      finishJob(job, accountId, "failed", {}, "Disconnected during sync.");
      return { ok: false, category: "not_connected", error: "This account isn't connected." };
    }
    const payload: SessionPayload = result.payload;
    transaction(db(), () => {
      const applied = applyPayload(row.user_id, accountId, payload, at);
      finishJob(job, accountId, "ok", applied, applied.note);
    });
    return { ok: true };
  } catch {
    // Not the error's text: this path has the password in scope.
    return failed("other", "The sync failed while saving. It will try again.");
  } finally {
    syncing.delete(accountId);
  }
}

/** Deletes the stored password and the live view. Trades and the account stay. */
export async function disconnectAccount(userId: number, accountId: number) {
  clearConnection(accountId);
  audit(userId, "mt5.disconnected", "account", accountId);
  await stopService(); // Ends the terminal and removes the login it saved in its own folder.
}
