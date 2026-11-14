import type { Metadata } from "next";
import { JetBrains_Mono, Manrope, Unbounded } from "next/font/google";
import { SiteChrome } from "@/components/site/SiteChrome";
import "./site.css";

// Unbounded: a wide, engineered display face for headlines; Manrope for reading; JetBrains Mono for figures and labels.
const display = Unbounded({ variable: "--font-site-display", subsets: ["latin"], weight: ["400", "500", "600"] });
const text = Manrope({ variable: "--font-site-text", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-site-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

const description = "Jarvis is a private trading journal and performance platform for forex and gold traders. MT5 sync with the read-only investor password, honest analytics from your own trades, and it runs on your own computer.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3100"),
  title: { default: "Jarvis: trading intelligence from your own record", template: "%s · Jarvis" },
  description,
  applicationName: "Jarvis",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Jarvis",
    title: "Jarvis: trading intelligence from your own record",
    description,
  },
  // The preview image is src/app/(site)/opengraph-image.tsx, which Next attaches to every site page.
  twitter: { card: "summary_large_image", title: "Jarvis: trading intelligence from your own record", description },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`site ${display.variable} ${text.variable} ${mono.variable}`}>
      <SiteChrome>{children}</SiteChrome>
    </div>
  );
}
