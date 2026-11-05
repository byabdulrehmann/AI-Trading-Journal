/** Starts MT5 sync with the server. It only ever acts on connections the user has stored. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/lib/server/mt5/scheduler")).startMt5Scheduler();
}
