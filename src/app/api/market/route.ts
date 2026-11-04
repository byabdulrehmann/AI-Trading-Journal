import { dynamic, json } from "@/lib/server/http";
import { marketProvider } from "@/lib/server/market/demo";

export async function GET(req: Request) {
  await dynamic();
  const provider = marketProvider();
  const url = new URL(req.url);
  const from = new Date();
  from.setDate(from.getDate() - 3);
  const to = new Date();
  to.setDate(to.getDate() + 10);
  const instruments = await provider.listInstruments();
  const symbols = url.searchParams.get("symbols")?.split(",").filter(Boolean) ?? instruments.map((i) => i.symbol);
  const contexts = (await Promise.all(symbols.map((s) => provider.getContext(s)))).filter(Boolean);
  return json({
    source: { id: provider.id, label: provider.label, dataKind: provider.dataKind, disclosure: provider.disclosure },
    instruments,
    contexts,
    calendar: await provider.getCalendar(from.toISOString(), to.toISOString()),
  });
}
