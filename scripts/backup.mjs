// Back up the Labbook database while the server keeps running, check the copy, and keep the newest N.
// Usage: npm run backup            (or: node scripts/backup.mjs)
// Settings: DATA_DIR (default ./data), BACKUP_DIR (default DATA_DIR/backups), BACKUP_KEEP (default 14)
// Copy the backup folder to another machine too (rsync, rclone, your university's storage): a backup on
// the same disk does not survive that disk failing.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.DATA_DIR || path.join(root, "data");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const source = path.join(DATA_DIR, "mdshare.sqlite");

if (!fs.existsSync(source)) { console.error(`No database at ${source}. Is DATA_DIR right?`); process.exit(1); }
fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 23);
const target = path.join(BACKUP_DIR, `mdshare-${stamp}.sqlite`);

// SQLite's online backup copies a consistent snapshot even while people are editing
const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();
fs.chmodSync(target, 0o600);

// A backup you haven't checked is a hope, not a backup
const copy = new Database(target, { readonly: true });
const integrity = copy.pragma("integrity_check", { simple: true });
const notes = copy.prepare("SELECT COUNT(*) AS n FROM notes").get().n;
let docs = 0; // Hocuspocus creates this table when the first note is saved
try { docs = copy.prepare("SELECT COUNT(*) AS n FROM documents").get().n; } catch {}
copy.close();
if (integrity !== "ok") { console.error(`Backup ${target} failed its integrity check: ${integrity}`); process.exit(1); }

const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^mdshare-.*\.sqlite$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
const kb = Math.round(fs.statSync(target).size / 1024);
console.log(`Backup OK: ${target} (${kb} KB, ${notes} notes, ${docs} documents)${old.length ? `; removed ${old.length} older backup(s)` : ""}`);
