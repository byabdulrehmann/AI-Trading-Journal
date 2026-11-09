import { requireUser } from "@/lib/server/auth";
import { body, json } from "@/lib/server/http";
import { TagRuleInput } from "@/lib/domain/autotag";
import { createRule, listRules } from "@/lib/server/autotag";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ rules: listRules(user.id) });
}

/** Saves the rule and runs it over the trades already there. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, TagRuleInput);
  if (data instanceof Response) return data;
  return json(createRule(user.id, data), 201);
}
