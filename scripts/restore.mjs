// Restore the Labnotebook database from a backup.
// 1. Stop the server.  2. npm run restore -- path/to/mdshare-YYYY-MM-DD_HH-MM-SS.sqlite --yes  3. Start the server.
// The current database is kept next to it as mdshare.sqlite.before-restore-<time>, so a restore can be undone.
import Database from "better-sqlite3";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.DATA_DIR || path.join(root, "data");
const PORT = Number(process.env.PORT || 3000);
const args = process.argv.slice(2);
const backup = args.find((a) => !a.startsWith("--"));
const target = path.join(DATA_DIR, "mdshare.sqlite");

if (!backup || !args.includes("--yes")) {
  console.error("Usage: npm run restore -- <backup file> --yes   (stop the server first)");
  process.exit(1);
}
if (!fs.existsSync(backup)) { console.error(`No such file: ${backup}`); process.exit(1); }

// Refuse while a server answers on this port: replacing the file under a running server loses data
const running = await new Promise((resolve) => {
  const s = net.connect({ port: PORT, host: "127.0.0.1" }, () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
});
if (running) { console.error(`Something is running on port ${PORT}. Stop the Labnotebook server first.`); process.exit(1); }

const check = new Database(backup, { readonly: true, fileMustExist: true });
const integrity = check.pragma("integrity_check", { simple: true });
const notes = check.prepare("SELECT COUNT(*) AS n FROM notes").get().n;
check.close();
if (integrity !== "ok") { console.error(`That backup is damaged (${integrity}); not restoring it.`); process.exit(1); }

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
if (fs.existsSync(target)) {
  const keep = `${target}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  // Fold the write-ahead log into the main file first so the saved copy is complete
  const cur = new Database(target); cur.pragma("wal_checkpoint(TRUNCATE)"); cur.close();
  fs.renameSync(target, keep);
  console.log(`Kept the current database as ${keep}`);
}
for (const ext of ["-wal", "-shm"]) fs.rmSync(target + ext, { force: true });
fs.copyFileSync(backup, target);
fs.chmodSync(target, 0o600);
console.log(`Restored ${notes} notes from ${backup}. Start the server again.`);
