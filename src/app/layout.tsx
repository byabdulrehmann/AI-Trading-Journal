import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/lib/client/app-state";
import { Shell } from "@/components/Shell";

const sans = Geist({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Jarvis",
  description: "A precise, private trading journal that runs on your own computer.",
};

export const viewport: Viewport = {
  themeColor: "#1b1d3d",
};

// Applies the saved theme before first paint. Light unless the user chose otherwise; "kestrel-theme" is the old key.
const themeScript = `try{var s=localStorage,t=s.getItem("jarvis-theme")||s.getItem("kestrel-theme")||"light";if(t!=="system")document.documentElement.dataset.theme=t;if(s.getItem("jarvis-nav")==="collapsed")document.documentElement.dataset.nav="collapsed"}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <AppStateProvider>
          <Shell>{children}</Shell>
        </AppStateProvider>
      </body>
    </html>
  );
}
