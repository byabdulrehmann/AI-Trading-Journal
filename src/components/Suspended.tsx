import { Suspense } from "react";
import { Spinner } from "./ui";

/** useSearchParams needs a Suspense boundary above it. */
export function Suspended({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}
