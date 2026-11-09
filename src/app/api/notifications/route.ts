import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { challengeAlerts } from "@/lib/server/progress";
import { listTrades } from "@/lib/server/repo/journal";
import { listConnections } from "@/lib/server/repo/mt5";
import { syncing } from "@/lib/server/mt5/sync";

export interface Notification {
  id: string;
  tone: "loss" | "warn" | "info";
  title: string;
  body: string;
  href: string;
}

/** Derived from the record each time, never stored: what needs attention now. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const out: Notification[] = [];

  for (const a of challengeAlerts(user.id, false)) {
    const breached = a.rule.state === "breached";
    out.push({
      id: `challenge-${a.challengeId}-${a.rule.key}`,
      tone: breached ? "loss" : "warn",
      title: `${a.name}: ${a.rule.label.toLowerCase()} ${breached ? "breached" : "close to its limit"}`,
      body: a.rule.key === "time" ? `${a.rule.value} of ${a.rule.limit} days gone.` : `${a.rule.value.toFixed(2)} of ${a.rule.limit.toFixed(2)} ${a.currency} used.`,
      href: "/progress",
    });
  }

  for (const c of listConnections(user.id, syncing)) {
    if (c.state === "auth_failed") out.push({ id: `mt5-auth-${c.accountId}`, tone: "loss", title: `${c.accountName}: MT5 refused the login`, body: "Syncing has stopped. Check the investor password on the Accounts page.", href: "/accounts" });
    else if (c.state === "error") out.push({ id: `mt5-error-${c.accountId}`, tone: "warn", title: `${c.accountName}: the last sync failed`, body: c.lastError ?? "Open the Accounts page for details.", href: "/accounts" });
    else if (c.stale && c.syncEnabled) out.push({ id: `mt5-stale-${c.accountId}`, tone: "info", title: `${c.accountName}: MT5 data is out of date`, body: c.lastSuccessAt ? `Last synced ${c.lastSuccessAt}.` : "It hasn't synced yet.", href: "/accounts" });
  }

  const pending = listTrades(user.id, { outcome: "pending" }).length;
  if (pending > 0) out.push({ id: "pending-trades", tone: "warn", title: `${pending} ${pending === 1 ? "trade is" : "trades are"} left out of your figures`, body: "A conversion rate is missing or the fills don't add up.", href: "/journal?outcome=pending" });

  return json({ notifications: out });
}
