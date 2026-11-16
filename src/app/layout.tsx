import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/lib/client/app-state";
import { Shell } from "@/components/Shell";
import { GATE_SCRIPT, SITE_THEME_SCRIPT } from "@/components/site/boot-scripts";

const sans = Geist({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"] });
const heading = Bricolage_Grotesque({ variable: "--font-heading", subsets: ["latin"], weight: ["500"] });

export const metadata: Metadata = {
  title: "Jarvis",
  description: "A precise, private trading journal that runs on your own computer.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ece6e5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0809" },
  ],
};

// Applies the saved theme before first paint. Light unless the user chose otherwise; "kestrel-theme" is the old key.
const themeScript = `try{var s=localStorage,t=s.getItem("jarvis-theme")||s.getItem("kestrel-theme")||"light";if(t!=="system")document.documentElement.dataset.theme=t;if(s.getItem("jarvis-nav")==="collapsed")document.documentElement.dataset.nav="collapsed"}catch(e){document.documentElement.dataset.theme="light"}`;

// Every page renders on request: each needs this request's nonce, which a page built ahead of time can't carry.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The proxy's nonce for this request: without it the strict script policy blocks these inline scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${heading.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* The website's and sign-in screens' mode, and whether this session is already past the site's entry gate. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SITE_THEME_SCRIPT + ";" + GATE_SCRIPT }} />
        {/* Without scripts nobody could press the gate's buttons, so it never shows. */}
        <noscript><style>{".s-gate{display:none}"}</style></noscript>
      </head>
      <body className="min-h-full">
        <AppStateProvider>
          <Shell>{children}</Shell>
        </AppStateProvider>
      </body>
    </html>
  );
}
