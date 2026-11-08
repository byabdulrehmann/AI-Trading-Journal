"use client";

import Link from "next/link";
import { money } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { RuleCheck } from "@/lib/domain/progress";
import { Notice } from "@/components/ui";

interface Alert {
  challengeId: number;
  name: string;
  currency: string;
  rule: RuleCheck;
}

/** What a rule at its warning level or past it means, in one line. */
export function alertText(a: { name: string; currency: string; rule: RuleCheck }): string {
  const { rule: r, currency } = a;
  const used = r.key === "time" ? `${r.value} of ${r.limit} days gone` : `${money(r.value, currency)} of ${money(r.limit, currency)} used`;
  const left = r.key === "time" ? "" : `, ${money(Math.max(0, r.limit - r.value), currency)} left`;
  return r.state === "breached" ? `${a.name}: ${r.label.toLowerCase()} breached. ${used}.` : `${a.name}: ${r.label.toLowerCase()} close to its limit. ${used}${left}.`;
}

/** Shown on the dashboard and the Progress page: limits close to breaking, or broken today. */
export function ChallengeAlerts({ includeSample, link = true }: { includeSample: boolean; link?: boolean }) {
  const { data } = useFetch<{ alerts: Alert[] }>(`/api/challenges?alerts=1${includeSample ? "&includeSample=1" : ""}`);
  if (!data?.alerts.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="challenge-alerts">
      {data.alerts.map((a) => (
        <Notice
          key={`${a.challengeId}-${a.rule.key}`}
          tone={a.rule.state === "breached" ? "loss" : "warn"}
          action={link ? <Link href="/progress" className="text-[13px] underline underline-offset-2">See the challenge</Link> : undefined}
        >
          {alertText(a)}
        </Notice>
      ))}
    </div>
  );
}
