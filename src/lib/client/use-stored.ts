"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * A per-browser preference that survives a refresh: the dashboard's month, tab, columns and the sidebar.
 * Storage can be blocked; then the fallback is used and the choice lasts only for this page.
 */
export function useStored(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key) ?? fallback, () => fallback);
  const set = useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

const noop = () => () => {};
/** An element the shell renders, found after hydration without an effect. */
export const useElement = (id: string) => useSyncExternalStore(noop, () => document.getElementById(id), () => null);
