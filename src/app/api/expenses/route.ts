import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { ExpenseInput, createExpense, listExpenses, spendingSummary } from "@/lib/server/progress";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const expenses = listExpenses(user.id);
  return json({ expenses, summary: spendingSummary(expenses) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, ExpenseInput);
  if (data instanceof Response) return data;
  const r = createExpense(user.id, data);
  return r.ok ? json({ expense: r.expense }, 201) : fail(r.reason, 422);
}
