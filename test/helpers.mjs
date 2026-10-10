// Shared test helpers: start a server on a throwaway database, and sign people in through the
// real magic-link flow (with no SMTP_URL the server prints each link, and the tests read it).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Never leave a server running behind a test that crashed or failed
const children = new Set();
process.on("exit", () => { for (const c of children) c.kill(); });

// Resolves once the server is listening; rejects with its output if it exits first
export function startServer(env) {
  const p = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, ANTHROPIC_API_KEY: "", SMTP_URL: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", ALLOWED_DOMAINS: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(p);
  p.on("exit", () => children.delete(p));
  let out = "";
  const srv = {
    proc: p,
    output: () => out,
    stop: () => new Promise((r) => { if (p.exitCode !== null) return r(); p.on("exit", r); p.kill(); }),
    // The newest sign-in link printed for this address
    async linkFor(email, { after = 0, timeout = 5000 } = {}) {
      const re = new RegExp(`Sign-in link for ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} [^:]*: (\\S+)`, "g");
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const links = [...out.slice(after).matchAll(re)].map((m) => m[1]);
        if (links.length) return links.at(-1);
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    },
  };
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  srv.ready = new Promise((resolve, reject) => {
    p.stdout.on("data", () => out.includes("Labnotebook running") && resolve(srv));
    p.on("exit", (code) => reject(Object.assign(new Error(`server exited ${code}: ${out}`), { code })));
  });
  return srv;
}

// Sign in without a browser; returns a Cookie header value
export async function signInFetch(base, srv, email) {
  const origin = { Origin: base };
  const mark = srv.output().length;
  await fetch(`${base}/auth/email`, { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...origin }, body: new URLSearchParams({ email, next: "/" }) });
  const link = await srv.linkFor(email, { after: mark });
  if (!link) throw new Error(`no sign-in link for ${email}`);
  const token = new URL(link).searchParams.get("token");
  const r = await fetch(`${base}/auth/email/verify`, { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...origin }, body: new URLSearchParams({ token }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie.startsWith("mdshare_session=")) throw new Error(`sign-in failed for ${email}: ${r.status} ${r.headers.get("location")}`);
  return cookie;
}

// Sign in through the real pages in a browser page
export async function signInBrowser(page, base, srv, email) {
  const mark = srv.output().length;
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.click("#send");
  await page.waitForURL(/sent=/);
  const link = await srv.linkFor(email, { after: mark });
  if (!link) throw new Error(`no sign-in link for ${email}`);
  await page.goto(link);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth") && !u.pathname.startsWith("/login"));
}

export function reporter() {
  const results = [];
  return {
    check: (name, ok, detail = "") => results.push({ name, ok: !!ok, ...(ok ? {} : { detail: String(detail).slice(0, 300) }) }),
    finish() {
      const failed = results.filter((r) => !r.ok);
      for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
      console.log(`\n${results.length - failed.length}/${results.length} passed`);
      return failed.length ? 1 : 0;
    },
  };
}
