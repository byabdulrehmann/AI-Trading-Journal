"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { money } from "@/lib/client/format";
import type { Trade } from "@/lib/domain/types";
import { Dialog, cx, inputClass } from "./ui";

interface Item {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const PAGES: [string, string][] = [
  ["/", "Dashboard"],
  ["/journal", "Journal"],
  ["/day", "Daily journal"],
  ["/playbooks", "Playbooks"],
  ["/notebook", "Notebook"],
  ["/calendar", "Calendar"],
  ["/analytics", "Analytics"],
  ["/patterns", "Patterns"],
  ["/market", "Market context"],
  ["/jarvis", "AI Coach"],
  ["/accounts", "Accounts & MT5"],
  ["/settings", "Settings"],
];

/** Ctrl-K or Cmd-K: go to any screen, log a trade, or jump to a trade by symbol, note or #id. */
export function CommandPalette() {
  const router = useRouter();
  const { editTrade, openTrade, accounts } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const ctrl = new AbortController();
    const wait = setTimeout(() => {
      api<{ trades: Trade[] }>(`/api/trades?pageSize=6&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => setTrades(r.trades))
        .catch(() => setTrades([]));
    }, 150);
    return () => {
      clearTimeout(wait);
      ctrl.abort();
    };
  }, [q, open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setTrades([]);
    setActive(0);
  };

  const needle = q.trim().toLowerCase();
  const items: Item[] = [
    { id: "new", label: "Log a trade", run: () => editTrade("new") },
    ...PAGES.map(([href, label]) => ({ id: href, label, hint: "Go to", run: () => router.push(href) })),
  ].filter((i) => !needle || i.label.toLowerCase().includes(needle));
  const currency = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency ?? "USD";
  const shown = needle.length >= 2 ? trades : [];
  const all: Item[] = [
    ...items,
    ...shown.map((t) => ({
      id: `t${t.id}`,
      label: `#${t.id} ${t.symbol} ${t.side}`,
      hint: t.pnl === null ? t.status : money(t.pnl, currency(t), true),
      run: () => openTrade(t.id),
    })),
  ];
  const current = Math.min(active, Math.max(all.length - 1, 0));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  return (
    <Dialog open={open} onClose={close} title="Go to">
      <input
        ref={input}
        data-autofocus
        aria-label="Search screens and trades"
        placeholder="A screen, a symbol, a note, or #id"
        className={inputClass}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, all.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(all[current]);
          }
        }}
      />
      <ul className="mt-2" aria-label="Results">
        {all.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => choose(item)}
              onMouseEnter={() => setActive(i)}
              className={cx("flex h-9 w-full items-center justify-between gap-3 px-2 text-left text-[14px]", i === current ? "bg-raised text-ink" : "text-ink-soft")}
            >
              <span className="truncate">{item.label}</span>
              {item.hint && <span className="num shrink-0 text-[12.5px] text-muted">{item.hint}</span>}
            </button>
          </li>
        ))}
        {all.length === 0 && <li className="px-2 py-3 text-[14px] text-muted">Nothing matches.</li>}
      </ul>
    </Dialog>
  );
}
