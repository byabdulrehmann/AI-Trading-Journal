"use client";

import { useCallback } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import type { Trade } from "@/lib/domain/types";

export function useTradeActions() {
  const { refresh, toast, openTrade } = useApp();

  const deleteTrades = useCallback(
    async (ids: number[]) => {
      try {
        await api("/api/trades/delete", { method: "POST", json: { ids, deleted: true } });
        openTrade(null);
        await refresh();
        toast({
          message: ids.length === 1 ? "Trade deleted." : `${ids.length} trades deleted.`,
          action: {
            label: "Undo",
            run: async () => {
              await api("/api/trades/delete", { method: "POST", json: { ids, deleted: false } });
              await refresh();
              toast({ message: "Restored.", tone: "success" });
            },
          },
        });
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : "Couldn't delete.", tone: "error" });
      }
    },
    [refresh, toast, openTrade],
  );

  const duplicateTrade = useCallback(
    async (id: number) => {
      try {
        const res = await api<{ trade: Trade }>(`/api/trades/${id}`, { method: "POST" });
        await refresh();
        toast({ message: `Copied as trade #${res.trade.id}.`, tone: "success", action: { label: "View", run: () => openTrade(res.trade.id) } });
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : "Couldn't duplicate.", tone: "error" });
      }
    },
    [refresh, toast, openTrade],
  );

  return { deleteTrades, duplicateTrade };
}
