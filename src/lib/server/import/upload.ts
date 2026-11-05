import "server-only";
import path from "node:path";
import { MAX_SHEET_ROWS, MAX_UPLOAD_BYTES, parseCsvRows, type SheetRow } from "@/lib/domain/csv";
import { UploadError } from "./errors";
import { readXlsx } from "./xlsx";

export interface UploadContent {
  format: "csv" | "xlsx";
  sheets: string[];
  sheet: string | null;
  rows: SheetRow[];
}

const startsWith = (bytes: Uint8Array, ...sig: number[]) => sig.every((b, i) => bytes[i] === b);

function decodeText(bytes: Uint8Array): string {
  // MT5 commonly saves text as UTF-16 with a BOM.
  if (startsWith(bytes, 0xff, 0xfe)) return new TextDecoder("utf-16le").decode(bytes);
  if (startsWith(bytes, 0xfe, 0xff)) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function readCsv(bytes: Uint8Array): SheetRow[] {
  const text = decodeText(bytes);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) throw new UploadError("This file holds binary data, so it isn't a real CSV. Export your history as .csv or .xlsx.");
  }
  if (/^\s*<(!doctype|html)/i.test(text)) throw new UploadError("This is a web page report. Export your history as .xlsx or .csv instead.");
  try {
    return parseCsvRows(text);
  } catch (e) {
    throw new UploadError(e instanceof Error ? e.message : "This CSV couldn't be read.");
  }
}

/** Decides by content. The extension only has to agree with what the bytes turn out to be. */
export function readUpload(name: string, bytes: Uint8Array, sheet?: string): UploadContent {
  if (bytes.length === 0) throw new UploadError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("Files over 10 MB aren't supported.", 413);
  const ext = path.extname(name).toLowerCase();
  if ([".xlsm", ".xlsb", ".xltm", ".xlam"].includes(ext)) throw new UploadError("Macro-enabled workbooks aren't accepted. Save it as a plain .xlsx without macros.");
  // An OLE container: legacy .xls, or an .xlsx protected with a password.
  if (ext === ".xls" || startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) throw new UploadError("Old .xls files and password-protected workbooks can't be read. Save it as an unprotected .xlsx or .csv.");
  if (ext !== ".csv" && ext !== ".xlsx") throw new UploadError("Upload a .csv or .xlsx file.");
  const isZip = startsWith(bytes, 0x50, 0x4b, 0x03, 0x04) || startsWith(bytes, 0x50, 0x4b, 0x05, 0x06);

  if (ext === ".xlsx") {
    if (!isZip) throw new UploadError("This file is named .xlsx but isn't an Excel workbook. Export it again as .xlsx or .csv.");
    return { format: "xlsx", ...readXlsx(bytes, sheet) };
  }
  if (isZip) throw new UploadError("This file is named .csv but is a zip or Excel file. Export it again as .csv, or upload it as .xlsx.");
  const rows = readCsv(bytes);
  if (rows.length > MAX_SHEET_ROWS) throw new UploadError(`This file has too many rows. Import up to ${(MAX_SHEET_ROWS - 100).toLocaleString("en-US")} at a time.`, 413);
  return { format: "csv", sheets: [], sheet: null, rows };
}
