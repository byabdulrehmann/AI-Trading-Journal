"use client";

import { Fragment } from "react";
import { useApp } from "@/lib/client/app-state";

/**
 * Minimal, safe renderer for Jarvis replies: paragraphs, bullet lists,
 * **bold**, _italic_, `code`, and [#123] trade references as buttons.
 * Builds React nodes only, with no HTML injection.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Label text={l} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Sets the Recorded / Possible pattern / Suggestion labels apart by weight. */
function Label({ text }: { text: string }) {
  const m = /^(Recorded|Possible pattern|Suggestion):\s*/.exec(text);
  if (!m) return <Inline text={text} />;
  return (
    <>
      <span className="font-medium text-ink">{m[1]}:</span> <Inline text={text.slice(m[0].length)} />
    </>
  );
}

function Inline({ text }: { text: string }) {
  const { openTrade } = useApp();
  // Italic underscores must sit at word edges, so names like ANTHROPIC_API_KEY stay intact.
  const parts = text.split(/(\[#\d+\]|\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))/g);
  return (
    <>
      {parts.map((p, i) => {
        const trade = /^\[#(\d+)\]$/.exec(p);
        if (trade)
          return (
            <button key={i} type="button" onClick={() => openTrade(Number(trade[1]))} className="num text-[0.92em] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink" title={`Open trade #${trade[1]}`}>
              #{trade[1]}
            </button>
          );
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-medium">{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="num bg-sunken px-1 text-[0.9em]">{p.slice(1, -1)}</code>;
        if (p.startsWith("_") && p.endsWith("_") && p.length > 2) return <em key={i} className="text-muted">{p.slice(1, -1)}</em>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
