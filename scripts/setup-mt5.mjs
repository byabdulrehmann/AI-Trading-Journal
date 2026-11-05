// Prepares the dedicated MT5 terminal Jarvis uses, so the user's own terminal is never touched.
// Run once: node scripts/setup-mt5.mjs
// Copies only terminal64.exe and servers.dat. Saved logins (accounts.dat, common.ini) are never copied or read.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const INSTALL = process.env.MT5_INSTALL_DIR || "C:\\Program Files\\MetaTrader 5";
const DEST = path.join(ROOT, "data", "mt5-terminal");
const VENV = path.join(ROOT, "services", "mt5", ".venv");
const VENV_PY = path.join(VENV, "Scripts", "python.exe");
const PACKAGE = "MetaTrader5==5.0.6180";

function die(message) {
  console.error(`setup-mt5: ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") die("the MetaTrader5 Python package only runs on Windows.");
if (!existsSync(path.join(INSTALL, "terminal64.exe"))) die(`terminal64.exe not found in ${INSTALL}. Set MT5_INSTALL_DIR if it is elsewhere.`);

// 1. Python environment
if (!existsSync(VENV_PY)) {
  console.log("Creating services/mt5/.venv ...");
  execFileSync("python", ["-m", "venv", VENV], { stdio: "inherit" });
}
console.log(`Installing ${PACKAGE} ...`);
execFileSync(VENV_PY, ["-m", "pip", "install", "--disable-pip-version-check", "--quiet", PACKAGE], { stdio: "inherit" });

// 2. Terminal copy
mkdirSync(path.join(DEST, "Config"), { recursive: true });
copyFileSync(path.join(INSTALL, "terminal64.exe"), path.join(DEST, "terminal64.exe"));
// The service refuses any terminal folder without this marker, and the user's install has none.
writeFileSync(path.join(DEST, "portable.txt"), "");
rmSync(path.join(DEST, "Config", "accounts.dat"), { force: true });
console.log(`Copied terminal64.exe to ${DEST}`);

// 3. Broker server list, so server names resolve. Only from the data folder belonging to this install.
const base = path.join(process.env.APPDATA ?? "", "MetaQuotes", "Terminal");
const folders = existsSync(base) ? readdirSync(base).filter((f) => /^[0-9A-F]{32}$/i.test(f)) : [];
const own = folders.find((f) => {
  const origin = path.join(base, f, "origin.txt");
  return existsSync(origin) && readFileSync(origin, "utf16le").replace(/^\uFEFF/, "").trim().toLowerCase() === INSTALL.toLowerCase();
});
const servers = own && path.join(base, own, "config", "servers.dat");
if (servers && existsSync(servers)) {
  copyFileSync(servers, path.join(DEST, "Config", "servers.dat"));
  console.log("Copied servers.dat (broker server list).");
} else {
  console.log("No servers.dat found. The terminal may not resolve broker server names until it has seen them.");
}
console.log("Done.");
