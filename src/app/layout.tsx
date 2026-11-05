import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/lib/client/app-state";
import { Shell } from "@/components/Shell";

const sans = Geist({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500"] });
const mono = Geist_Mono({ variable: "--font-figures", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Jarvis",
  description: "A precise, private trading journal that runs on your own computer.",
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
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
