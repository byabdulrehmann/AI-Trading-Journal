"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useApp } from "./app-state";

/**
 * Reads a URL, and reads it again after any data change. Keeps the previous result while
 * the next one loads, so filters don't flash an empty page. A null url fetches nothing.
 */
export function useFetch<T>(url: string | null) {
  const { dataVersion } = useApp();
  const [retry, setRetry] = useState(0);
  const key = url && `${url}#${dataVersion}#${retry}`;
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string }>({ key: null });

  useEffect(() => {
    if (!url) return;
    let live = true;
    api<T>(url).then(
      (data) => live && setState({ key, data }),
      (e) => live && setState((s) => ({ key, data: s.data, error: e instanceof Error ? e.message : "Couldn't load this." })),
    );
    return () => {
      live = false;
    };
  }, [url, key]);

  return {
    data: url ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: url !== null && state.key !== key,
    reload: useCallback(() => setRetry((n) => n + 1), []),
  };
}
