"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/client/app-state";
import { dateOnly, duration, money, rFmt } from "@/lib/client/format";
import type { Trade } from "@/lib/domain/types";
import { Button, Dialog, Toggle } from "../ui";

interface Options {
  money: boolean;
  prices: boolean;
  setup: boolean;
}

const W = 1200;
const H = 630;

/** Drawn on a canvas in this browser. The picture is saved or copied from here and never uploaded. */
function draw(canvas: HTMLCanvasElement, t: Trade, currency: string, o: Options) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const face = getComputedStyle(document.body).fontFamily;
  const fit = (text: string, max: number) => {
    let s = text;
    while (s.length > 1 && ctx.measureText(s).width > max) s = s.slice(0, -2);
    return s === text ? s : `${s.trimEnd()}…`;
  };

  ctx.fillStyle = token("--surface");
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = token("--line-strong");
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const tone = (n: number | null) => token(n === null || n === 0 ? "--ink" : n > 0 ? "--profit" : "--loss");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = token("--muted");
  ctx.font = `500 28px ${face}`;
  ctx.fillText(`${t.side === "long" ? "Long" : "Short"}, ${t.assetClass}`, 72, 104);
  ctx.fillStyle = token("--ink");
  ctx.font = `500 76px ${face}`;
  ctx.fillText(fit(t.symbol, W - 144), 72, 184);

  const result = t.status !== "closed" ? "Open" : t.rMultiple !== null ? rFmt(t.rMultiple) : o.money ? money(t.pnl, currency, true) : t.pnl === null ? "Pending" : t.pnl > 0 ? "Win" : t.pnl < 0 ? "Loss" : "Breakeven";
  ctx.fillStyle = t.status !== "closed" ? token("--ink") : tone(t.rMultiple ?? t.pnl);
  ctx.font = `500 132px ${face}`;
  ctx.fillText(result, 72, 340);
  if (o.money && t.status === "closed" && t.rMultiple !== null && t.pnl !== null) {
    const after = 72 + ctx.measureText(result).width + 48;
    ctx.font = `500 44px ${face}`;
    ctx.fillStyle = tone(t.pnl);
    ctx.fillText(money(t.pnl, currency, true), after, 340);
  }

  const facts: [string, string][] = [
    ...(o.prices ? ([["Entry", String(t.entryPrice)], ["Exit", t.exitPrice === null ? "Open" : String(t.exitPrice)]] as [string, string][]) : []),
    ["Held", duration(t.holdingMinutes)],
    [t.closedAt ? "Closed" : "Opened", dateOnly(t.closedAt ?? t.openedAt)],
  ];
  const colW = (W - 144) / Math.max(facts.length, 1);
  facts.forEach(([label, value], i) => {
    ctx.fillStyle = token("--muted");
    ctx.font = `400 24px ${face}`;
    ctx.fillText(label, 72 + i * colW, 430);
    ctx.fillStyle = token("--ink");
    ctx.font = `500 36px ${face}`;
    ctx.fillText(fit(value, colW - 24), 72 + i * colW, 476);
  });

  ctx.fillStyle = token("--line");
  ctx.fillRect(72, 528, W - 144, 2);
  ctx.font = `400 24px ${face}`;
  ctx.fillStyle = token("--muted");
  const setup = o.setup ? [t.strategy, t.setup].filter(Boolean).join(", ") : "";
  if (setup) ctx.fillText(fit(setup, W - 420), 72, 574);
  ctx.textAlign = "right";
  ctx.fillText("Journaled in Jarvis", W - 72, 574);
  ctx.textAlign = "left";
}

export function ShareCard({ trade, currency, open, onClose }: { trade: Trade; currency: string; open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const [o, setO] = useState<Options>({ money: false, prices: true, setup: true });
  const canCopy = typeof navigator !== "undefined" && "clipboard" in navigator && typeof ClipboardItem !== "undefined";

  useEffect(() => {
    if (!open) return;
    // The dialog's canvas mounts with it: draw on the next frame, once it exists.
    const id = requestAnimationFrame(() => ref.current && draw(ref.current, trade, currency, o));
    return () => cancelAnimationFrame(id);
  }, [open, trade, currency, o]);

  const blob = () =>
    new Promise<Blob>((resolve, reject) => {
      if (!ref.current) return reject(new Error("no canvas"));
      ref.current.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png");
    });
  const save = async () => {
    try {
      const url = URL.createObjectURL(await blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${trade.symbol}-trade-${trade.id}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast({ message: "Couldn't make the picture.", tone: "error" });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      toast({ message: "Picture copied. Paste it where you want to share it.", tone: "success" });
    } catch {
      toast({ message: "This browser didn't allow copying the picture. Save it instead.", tone: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Share trade #${trade.id}`} wide>
      <div className="flex flex-col gap-4">
        <canvas ref={ref} width={W} height={H} className="h-auto w-full border border-line" role="img" aria-label={`Picture of ${trade.symbol} trade #${trade.id}`} data-testid="share-canvas" />
        <div className="divide-y divide-line">
          <Toggle label="Show money amounts" checked={o.money} onChange={(money) => setO({ ...o, money })} description="Off by default, so the picture shows R but not your account's size." />
          <Toggle label="Show entry and exit prices" checked={o.prices} onChange={(prices) => setO({ ...o, prices })} />
          <Toggle label="Show strategy and setup" checked={o.setup} onChange={(setup) => setO({ ...o, setup })} />
        </div>
        <p className="text-[13px] text-muted">The picture is made in this browser. Jarvis doesn&apos;t upload it or make a link: it goes only where you save or paste it. Notes, account name and broker details are never on it.</p>
        <div className="flex flex-wrap justify-end gap-2">
          {canCopy && <Button onClick={() => void copy()}>Copy picture</Button>}
          <Button variant="primary" onClick={() => void save()}>Save picture</Button>
        </div>
      </div>
    </Dialog>
  );
}
