import "server-only";
import { reportingCurrencies } from "@/lib/domain/metrics";
import { getAccount, listAccounts, listTrades, type TradeFilters } from "./repo/journal";

/**
 * The trades to report on and the currency they're in. Money never mixes currencies: with none chosen it reports in
 * the first one that has trades, and lists the others so the page can offer them.
 */
export function currencyScope(userId: number, filters: TradeFilters) {
  const accounts = listAccounts(userId);
  const unscoped = listTrades(userId, { ...filters, currency: undefined });
  const { currencies, primary } = reportingCurrencies(accounts, unscoped);
  const accountCurrency = filters.accountId ? getAccount(userId, filters.accountId)?.currency : undefined;
  const currency = accountCurrency ?? (filters.currency && currencies.includes(filters.currency) ? filters.currency : primary) ?? "USD";
  const ids = new Set(accounts.filter((a) => a.currency === currency).map((a) => a.id));
  return { accounts, currency, currencies, trades: unscoped.filter((t) => ids.has(t.accountId)) };
}
