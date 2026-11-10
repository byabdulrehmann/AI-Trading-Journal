import type { Metadata } from "next";
import { Suspense } from "react";
import { EarlyAccessForm } from "@/components/site/EarlyAccessForm";
import { PageHead } from "@/components/site/PageBlocks";

export const metadata: Metadata = {
  title: "Contact and early access",
  description: "Request early access to Jarvis, the private trading journal and performance platform.",
  alternates: { canonical: "/contact" },
};

/** Reads the outcome of a no-JavaScript submission, which the server reports through the query string. */
async function Outcome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <EarlyAccessForm initial={q.sent === "1" ? "sent" : q.error === "1" ? "error" : undefined} />;
}

export default function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      <PageHead title="Experience Jarvis." lede="Jarvis is in early access. Leave your details and what you trade, and the owner of this installation will see your request." />
      <section id="early-access" className="s-section scroll-mt-20 pt-0" aria-labelledby="ea-title">
        <div className="s-wrap grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <h2 id="ea-title" className="s-display s-h3">Request early access</h2>
            <dl className="mt-8 flex flex-col gap-6">
              {[
                ["What happens to your details", "They are saved in this Jarvis's own database. Nothing is emailed or sent to anyone else."],
                ["What you get", "A conversation about access. Jarvis runs on your own computer, so access is set up with you."],
                ["Already have Jarvis?", "Sign in from the top of the page."],
              ].map(([k, v]) => (
                <div key={k} className="border-t border-[var(--s-line)] pt-5">
                  <dt className="text-[16px] font-semibold text-[var(--s-ink)]">{k}</dt>
                  <dd className="s-body mt-1.5 text-[15px]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative">
            <Suspense fallback={<EarlyAccessForm />}>
              <Outcome searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </section>
    </>
  );
}
