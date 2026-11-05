import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/lib/client/app-state";
import { Shell } from "@/components/Shell";

const sans = Hanken_Grotesk({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-figures", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Jarvis",
  description: "A precise, private trading journal that runs on your own computer.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d0e",
};

// Applies the saved theme before first paint. Dark unless the user chose otherwise; "kestrel-theme" is the old key.
const themeScript = `try{var s=localStorage,t=s.getItem("jarvis-theme")||s.getItem("kestrel-theme")||"dark";if(t!=="system")document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
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
