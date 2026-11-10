import type { Metadata } from "next";
import { Home } from "@/components/site/home/Home";

export const metadata: Metadata = {
  title: { absolute: "Jarvis: trading intelligence from your own record" },
  alternates: { canonical: "/welcome" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Jarvis",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Windows",
  description: "A private trading journal and performance platform that runs on your own computer, with read-only MT5 sync.",
};

export default function WelcomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Home />
    </>
  );
}
