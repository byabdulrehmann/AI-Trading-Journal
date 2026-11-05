import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

/** Playwright stops the server after this runs and the server holds its files open, so a detached process outlasts it and removes them. */
export default function teardown() {
  writeFileSync("next-env.d.ts", process.env.E2E_NEXT_ENV!);
  const remove = (dir: string) => `fs.rmSync(${JSON.stringify(dir)},{recursive:true,force:true,maxRetries:60,retryDelay:250});`;
  const script = `const fs=require("fs");${remove(process.env.E2E_DATA_DIR!)}${remove(".next-e2e")}`;
  spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
