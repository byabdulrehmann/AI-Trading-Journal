"use client";

import { useCallback } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";

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

  return { deleteTrades };
}
