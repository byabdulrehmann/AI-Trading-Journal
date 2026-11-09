import { classifySymbol } from "@/lib/domain/engine/instruments";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { json } from "@/lib/server/http";
import { listAccounts, listImports, listTrades } from "@/lib/server/repo/journal";
import { listConnections, listOpenPositions } from "@/lib/server/repo/mt5";
import { syncing } from "@/lib/server/mt5/sync";

interface PositionRow {
  broker_position_id: string;
  symbol: string;
  side: string;
  volume: number;
  price_open: number;
  price_current: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  swap: number | null;
  profit: number | null;
  opened_at: string | null;
  synced_at: string | null;
}

/**
 * The dashboard's live side: the last import and sync, and what is open now. MT5 accounts show the positions from
 * their last sync, marked stale when the sync is old; other accounts show their open journal trades, with no price.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const filters = filtersFrom(new URL(req.url).searchParams);
  if (filters instanceof Response) return filters;

  const accounts = listAccounts(user.id).filter((a) => a.source !== "backtest");
  const connections = listConnections(user.id, syncing);
  const connected = new Set(connections.map((c) => c.accountId));
  const wanted = (accountId: number) => !filters.accountId || filters.accountId === accountId;
  const symbolOk = (s: string) => !filters.symbol || filters.symbol === s;

  const positions = connections.filter((c) => wanted(c.accountId)).flatMap((c) =>
    (listOpenPositions(c.accountId) as unknown as PositionRow[]).filter((p) => symbolOk(p.symbol)).map((p) => ({
      key: `mt5-${c.accountId}-${p.broker_position_id}`,
      kind: "mt5" as const,
      accountId: c.accountId,
      accountName: c.accountName,
      currency: c.currency,
      stale: c.stale,
      syncedAt: p.synced_at ?? c.lastSuccessAt,
      symbol: p.symbol,
      instrument: classifySymbol(p.symbol) as string,
      side: p.side === "sell" || p.side === "short" ? "short" : "long",
      volume: p.volume,
      entryPrice: p.price_open,
      currentPrice: p.price_current,
      stopLoss: p.stop_loss,
      takeProfit: p.take_profit,
      floatingPnl: p.profit === null ? null : p.profit + (p.swap ?? 0),
      openedAt: p.opened_at,
      tradeId: null as number | null,
    })),
  );
  const manual = listTrades(user.id, { outcome: "open", accountId: filters.accountId, symbol: filters.symbol, includeSample: filters.includeSample })
    .filter((t) => !connected.has(t.accountId) && accounts.some((a) => a.id === t.accountId))
    .map((t) => {
      const a = accounts.find((x) => x.id === t.accountId);
      return {
        key: `trade-${t.id}`,
        kind: "manual" as const,
        accountId: t.accountId,
        accountName: a?.name ?? "",
        currency: a?.currency ?? null,
        stale: false,
        syncedAt: null,
        symbol: t.symbol,
        instrument: t.assetClass as string,
        side: t.side,
        volume: t.quantity,
        entryPrice: t.entryPrice,
        currentPrice: null,
        stopLoss: t.stopPrice,
        takeProfit: t.targetPrice,
        floatingPnl: null,
        openedAt: t.openedAt,
        tradeId: t.id,
      };
    });

  const last = (listImports(user.id) as { created_at: string; filename: string }[])[0];
  const lastSync = connections.map((c) => c.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
  return json({
    lastImport: last ? { at: last.created_at, filename: last.filename } : null,
    lastSync,
    connections,
    positions: [...positions, ...manual].sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "")),
  });
}
