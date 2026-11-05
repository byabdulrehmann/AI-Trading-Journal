"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";

const PAGE = 200; // The API's largest page.

/** Trade id to symbol for the Tape's readout: the equity curve carries ids only. Pages through /api/trades for the same query. A null query reads nothing. */
export function useSymbols(query: string | null): Map<number, string> {
  const { dataVersion } = useApp();
  const [symbols, setSymbols] = useState<Map<number, string>>(() => new Map());
  useEffect(() => {
    if (query === null) return;
    let live = true;
    (async () => {
      const found = new Map<number, string>();
      for (let page = 1; live; page++) {
        const r = await api<{ trades: { id: number; symbol: string }[]; total: number }>(`/api/trades?${query}&sort=closedAt&dir=desc&pageSize=${PAGE}&page=${page}`);
        for (const t of r.trades) found.set(t.id, t.symbol);
        if (live) setSymbols(new Map(found));
        if (page * PAGE >= r.total || r.trades.length === 0) break;
      }
    })().catch(() => undefined); // The readout just goes without a symbol; every figure still shows.
    return () => {
      live = false;
    };
  }, [query, dataVersion]);
  return symbols;
}
