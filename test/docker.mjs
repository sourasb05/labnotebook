// End-to-end check of a running Docker container: sign-in, private notes, sharing, live co-editing,
// restart, healthcheck. Reads sign-in links from `docker logs`, so the container must have no SMTP_URL.
// Usage (see README, "Test the Docker image"):
//   docker run -d --name labnotebook-test ... -e ALLOWED_DOMAINS=example.org -e PUBLIC_URL=http://localhost:3001 labnotebook:test
//   npm run test:docker
// On a server, keep the browser on your laptop: tunnel the port and run docker over ssh:
//   ssh -N -L 3001:127.0.0.1:3001 you@server &
//   DOCKER="ssh you@server docker" npm run test:docker
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { reporter } from "./helpers.mjs";

const BASE = process.env.BASE || "http://localhost:3001";
const CONTAINER = process.env.CONTAINER || "labnotebook-test";
const DOCKER = process.env.DOCKER || "docker";
const DOMAIN = process.env.DOMAIN || "example.org"; // must be in the container's ALLOWED_DOMAINS
const docker = (args) => execSync(`${DOCKER} ${args}`, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const logs = () => execSync(`${DOCKER} logs ${CONTAINER} 2>&1`).toString();
const health = () => docker(`inspect -f '{{.State.Health.Status}}' ${CONTAINER}`).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = reporter();

async function linkFor(email, after) {
  const re = new RegExp(`Sign-in link for ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} [^:]*: (\\S+)`, "g");
  for (const end = Date.now() + 15000; Date.now() < end; await sleep(500)) {
    const links = [...logs().slice(after).matchAll(re)].map((m) => m[1]);
    if (links.length) return links.at(-1);
  }
  throw new Error(`no sign-in link for ${email} in the logs of ${CONTAINER} (is SMTP_URL unset?)`);
}

async function signIn(page, email) {
  const mark = logs().length;
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.click("#send");
  await page.waitForURL(/sent=/);
  await page.goto(await linkFor(email, mark));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth") && !u.pathname.startsWith("/login"));
}

check("container is healthy", health() === "healthy", health());
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const page = async () => { const p = await (await browser.newContext()).newPage(); p.on("pageerror", (e) => errors.push(e.message)); return p; };
const A = await page(), B = await page();
const alice = `alice@${DOMAIN}`, bob = `bob@${DOMAIN}`;

await signIn(A, alice);
check("Alice signs in with an email link", true);
await A.goto(`${BASE}/new`);
await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
const url = A.url(), id = new URL(url).pathname.split("/").pop();
await A.evaluate(() => { const y = window.__mdshare.ytext; y.delete(0, y.length); y.insert(0, "# Docker check\n\n$E=mc^2$ written inside the container.\n"); });
await A.waitForSelector(".katex");
check("note saves edits and renders LaTeX", true);

const anon = await fetch(url, { redirect: "manual" });
check("signed-out visitor can't open the note", anon.status !== 200, anon.status);
const csp = (await fetch(`${BASE}/login`)).headers.get("content-security-policy") || "";
check("strict Content-Security-Policy sent", /script-src 'self'/.test(csp) && !/unsafe-eval/.test(csp), csp);

await signIn(B, bob);
await B.goto(url);
check("Bob can't open a note not shared with him", (await B.content()).includes("have access"));
const added = await A.evaluate(async ({ id, bob }) => (await fetch(`/api/notes/${id}/members`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: bob, role: "editor" }),
})).status, { id, bob });
check("Alice shares the note with Bob as editor", added < 300, added);
await B.goto(url);
await B.waitForFunction(() => window.__mdshare?.provider.isSynced);
await B.evaluate(() => window.__mdshare.ytext.insert(window.__mdshare.ytext.length, "Bob was here.\n"));
await A.waitForFunction(() => window.__mdshare.ytext.toString().includes("Bob was here"), null, { timeout: 10000 });
check("Bob's edit appears live for Alice (WebSocket works)", true);

await sleep(3000); // let the debounced save (1.5 s) run
docker(`restart ${CONTAINER}`);
for (let i = 0; i < 60 && health() !== "healthy"; i++) await sleep(1000);
check("container is healthy again after a restart", health() === "healthy", health());
await A.goto(url);
await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
const after = await A.evaluate(() => window.__mdshare.ytext.toString());
check("note and session survive the restart", after.includes("written inside the container") && after.includes("Bob was here"), after);

const backup = docker(`exec ${CONTAINER} node scripts/backup.mjs`);
check("backup runs inside the container", /Backup OK/.test(backup), backup);
check("no browser errors", errors.length === 0, errors.join("; "));

await browser.close();
process.exit(finish());
