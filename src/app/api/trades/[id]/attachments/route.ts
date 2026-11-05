import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { ATTACHMENT_KINDS, AttachmentError, MAX_ATTACHMENT_BYTES, saveAttachment } from "@/lib/server/attachments";
import { fail, idParam, json } from "@/lib/server/http";

const Kind = z.enum(ATTACHMENT_KINDS);
// Room for the multipart wrapping around a file at the limit.
const MAX_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024;

export async function POST(req: Request, ctx: RouteContext<"/api/trades/[id]/attachments">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Trade not found.", 404);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return fail("Files can be up to 10 MB.", 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Choose a file to attach.", 400);
  const kind = Kind.safeParse(form?.get("kind") ?? "chart");
  if (!kind.success) return fail("Unknown attachment kind.", 422);
  try {
    const attachment = saveAttachment(user.id, id, { kind: kind.data, filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return json({ attachment }, 201);
  } catch (err) {
    if (err instanceof AttachmentError) return fail(err.message, err.status);
    throw err;
  }
}
