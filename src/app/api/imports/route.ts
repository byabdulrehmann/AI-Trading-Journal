import { MAX_UPLOAD_BYTES } from "@/lib/domain/csv";
import { requireUser } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { UploadError } from "@/lib/server/import/errors";
import { ImportRequest, commitImport, previewImport } from "@/lib/server/import/service";
import { listImports } from "@/lib/server/repo/journal";

const TOO_LARGE = "Files over 10 MB aren't supported.";
const MULTIPART_OVERHEAD = 200_000;

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ imports: listImports(user.id) });
}

/** Multipart: `file`, plus `options` as JSON. Preview unless options.commit is true. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) return fail(TOO_LARGE, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("The upload couldn't be read. Choose the file again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file to import.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(TOO_LARGE, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("options") ?? "{}"));
  } catch {
    return fail("The import options couldn't be read.");
  }
  const parsed = ImportRequest.safeParse(raw);
  if (!parsed.success) return fail("Some fields need attention.", 422, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));

  try {
    const upload = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    return parsed.data.commit ? json(commitImport(user.id, upload, parsed.data), 201) : json(previewImport(user.id, upload, parsed.data));
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    console.error("Import failed", e);
    return fail("The import failed and nothing was saved.", 500);
  }
}
