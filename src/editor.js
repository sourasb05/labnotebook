// Browser side of a note page: CodeMirror editor + live Markdown/LaTeX preview,
// synced through Hocuspocus (Yjs) with live cursors and presence.
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { EditorView, basicSetup } from "codemirror";
import { keymap, Decoration, MatchDecorator, ViewPlugin } from "@codemirror/view";
import { EditorSelection, EditorState, Compartment, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import DOMPurify from "dompurify";

const $ = (s) => document.querySelector(s);
const noteId = location.pathname.split("/").pop();

// ---------- Who am I ----------
const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let myName = store.get("mdshare_name") || `Guest ${Math.floor(100 + Math.random() * 900)}`;
let myColor = store.get("mdshare_color") || COLORS[Math.floor(Math.random() * COLORS.length)];
store.set("mdshare_color", myColor);

// ---------- Sync ----------
const ydoc = new Y.Doc();
const ytext = ydoc.getText("markdown");
const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;
const provider = new HocuspocusProvider({ url: wsUrl, name: noteId, document: ydoc });
const awareness = provider.awareness;
awareness.setLocalStateField("user", { name: myName, color: myColor, colorLight: myColor + "33" });

// ---------- Editor ----------
// Colours come from CSS variables, so the editor follows the Light / Paper / Dark theme.
const editorTheme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "var(--bg)" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--sel) !important" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--faint)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--bg-sunk)", border: "none", color: "var(--muted)" },
  ".cm-tooltip": { backgroundColor: "var(--bg)", border: "1px solid var(--line)", borderRadius: "8px" },
  ".cm-panels": { backgroundColor: "var(--bg-soft)", color: "var(--text)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
});
const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.35em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.18em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, color: "var(--hl-code)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName, t.angleBracket, t.tagName, t.attributeName, t.attributeValue], color: "var(--faint)" },
  { tag: t.keyword, color: "var(--syn-kw)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-str)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--syn-num)" },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: "var(--syn-fn)" },
  { tag: t.comment, color: "var(--faint)", fontStyle: "italic" },
]);
// Show text colours and highlights inside the editor too, with their HTML tags dimmed
const COLOR_TAG = /<(span|mark) style="(color|background-color):(#[0-9a-fA-F]{3,8})">(.*?)<\/\1>/g;
const dimTag = Decoration.mark({ class: "cm-md-tag" });
const colorMarks = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = this.matcher.createDeco(v); }
  update(u) { this.decorations = this.matcher.updateDeco(u, this.decorations); }
  get matcher() {
    return (this._m ??= new MatchDecorator({
      regexp: COLOR_TAG,
      decorate: (add, from, to, m) => {
        const open = m[0].indexOf(">") + 1, close = m[1].length + 3;
        const style = m[2] === "color" ? `color:${m[3]}` : `background-color:${m[3]}`;
        add(from, from + open, dimTag);
        if (to - close > from + open) add(from + open, to - close, Decoration.mark({ class: m[2] === "color" ? "" : "cm-md-hl", attributes: { style } }));
        add(to - close, to, dimTag);
      },
    }));
  }
}, { decorations: (p) => p.decorations });

// Editing stays off until the server confirms this person may edit (viewers stay read-only)
const editable = new Compartment();
const editableExt = (on) => [EditorView.editable.of(on), EditorState.readOnly.of(!on)];

const undoManager = new Y.UndoManager(ytext);
const view = new EditorView({
  parent: $("#editor"),
  extensions: [
    basicSetup,
    Prec.high(keymap.of(formattingKeys())),
    keymap.of([...yUndoManagerKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(markdownStyle),
    editorTheme,
    colorMarks,
    EditorView.lineWrapping,
    editable.of(editableExt(false)),
    yCollab(ytext, awareness, { undoManager }),
  ],
});

// ---------- Preview (Markdown + LaTeX, sanitised) ----------
const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
md.use(texmath, { engine: katex, delimiters: "dollars", katexOptions: { throwOnError: false, output: "htmlAndMathml" } });
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});
// Notes may set a text or highlight colour, nothing else: any other inline CSS is dropped.
// KaTeX's own output (inside .katex) keeps its layout styles; #preview's `contain: paint` keeps
// anything that tries to hide inside a fake .katex from drawing outside the page.
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName !== "style" || node.closest?.(".katex")) return;
  const keep = data.attrValue.split(";").map((d) => d.split(":").map((s) => s.trim().toLowerCase()))
    .filter(([p, v]) => (p === "color" || p === "background-color") && /^#[0-9a-f]{3,8}$/.test(v || ""))
    .map(([p, v]) => `${p}:${v}`);
  if (keep.length) data.attrValue = keep.join(";"); else data.keepAttr = false;
});
const preview = $("#preview");
let pending = false;
function render() {
  pending = false;
  const src = ytext.toString();
  // No <style> (could restyle the whole page) and no form controls (could fake a login box)
  preview.innerHTML = DOMPurify.sanitize(md.render(src), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
  });
  const h = src.match(/^\s*#\s+(.+)$/m);
  const title = (h ? h[1] : "Untitled").replace(/<[^>]*>/g, "").replace(/[#*_`$~=]/g, "").trim() || "Untitled";
  document.title = `${title} · Labbook`;
  $("#title").textContent = title;
  const words = src.replace(/<[^>]*>/g, " ").match(/[\p{L}\p{N}]+/gu)?.length || 0;
  $("#wordcount").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · ${Math.max(1, Math.round(words / 230))} min read`;
  $("#wordcount").title = `${src.length.toLocaleString()} characters`;
}
ytext.observe(() => { if (!pending) { pending = true; requestAnimationFrame(render); } });

// First load: seed an empty new note with a template (only people who may edit)
provider.on("synced", () => {
  if (provider.authorizedScope === "read-write" && ytext.length === 0 && !store.get(`seeded_${noteId}`)) {
    ytext.insert(0, "# Untitled note\n\nStart writing **Markdown** here. Math works too: $E = mc^2$ and\n\n$$\n\\nabla_\\theta \\mathcal{L}(\\theta) = \\frac{1}{n}\\sum_{i=1}^{n} \\nabla_\\theta \\ell(x_i, y_i; \\theta)\n$$\n");
    store.set(`seeded_${noteId}`, "1");
  }
  render();
});

// ---------- Status ----------
const statusEl = $("#status");
function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = `status ${cls}`; }
let connStatus = "connecting";
provider.on("status", ({ status }) => {
  connStatus = status;
  if (status === "connected") setStatus("Connected", "ok");
  else if (status === "connecting") setStatus("Connecting…", "warn");
  else setStatus("Offline — edits kept locally", "bad");
});
provider.on("unsyncedChanges", ({ number }) => {
  if (connStatus !== "connected") return;
  if (number > 0) setStatus("Saving…", "warn");
  else setStatus("Saved", "ok");
});
// ---------- Access (the server decides; this only mirrors it in the UI) ----------
let canEdit = false;
function setEditable(on) {
  canEdit = on;
  view.dispatch({ effects: editable.reconfigure(editableExt(on)) });
  document.body.dataset.readonly = String(!on);
  $("#role-badge").hidden = on;
  if (!on && !ai.panel.hidden) closeRephrase();
}
function showBanner(text) { const b = $("#banner"); b.textContent = text; b.hidden = !text; }
function lostAccess(text) {
  showBanner(text);
  setEditable(false);
  setStatus("No access", "bad");
  provider.disconnect();
}
provider.on("authenticated", ({ scope }) => {
  const wasEditable = canEdit;
  setEditable(scope === "read-write");
  showBanner("");
  if (wasEditable && scope !== "read-write") flash("You can now only view this note");
  else if (!wasEditable && scope === "read-write" && accessChanged) flash("You can now edit this note");
  accessChanged = false;
});
let accessChanged = false;
provider.on("authenticationFailed", () => lostAccess("You don't have access to this note any more. Ask its owner to share it with you."));
provider.on("close", ({ event }) => {
  const code = event?.code;
  if (code === 4401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  else if (code === 4403) lostAccess("Your access to this note was removed. Ask its owner to share it with you again.");
  else if (code === 4409) accessChanged = true; // the provider reconnects and the server applies the new rights
});

// ---------- Presence (who is online) ----------
const people = $("#people");
function renderPeople() {
  people.replaceChildren();
  const states = [...awareness.getStates().entries()].filter(([, s]) => s.user);
  states.sort(([a], [b]) => (a === awareness.clientID ? -1 : b === awareness.clientID ? 1 : 0));
  for (const [id, s] of states) {
    const el = document.createElement("span");
    el.className = "avatar";
    el.style.background = s.user.color;
    el.textContent = (s.user.name || "?").trim().slice(0, 1).toUpperCase();
    el.title = s.user.name + (id === awareness.clientID ? " (you)" : "");
    people.append(el);
  }
  $("#count").textContent = states.length === 1 ? "Only you" : `${states.length} online`;
}
awareness.on("change", renderPeople);
renderPeople();

// ---------- Name ----------
// Signed-in people start with their account name; anyone can still change how they appear
if (!store.get("mdshare_name")) {
  fetch("/api/me").then((r) => r.json()).then((me) => {
    if (me.local || !me.name || store.get("mdshare_name")) return;
    myName = me.name; nameInput.value = myName;
    awareness.setLocalStateField("user", { name: myName, color: myColor, colorLight: myColor + "33" });
  }).catch(() => {});
}
const nameInput = $("#name");
nameInput.value = myName;
nameInput.style.borderColor = myColor;
nameInput.addEventListener("change", () => {
  myName = nameInput.value.trim().slice(0, 40) || myName;
  nameInput.value = myName;
  store.set("mdshare_name", myName);
  awareness.setLocalStateField("user", { name: myName, color: myColor, colorLight: myColor + "33" });
});

// ---------- View mode ----------
const main = $("main");
function setMode(mode) {
  main.dataset.mode = mode;
  document.querySelectorAll("[data-set-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setMode === mode)));
  store.set("mdshare_mode", mode);
  view.requestMeasure();
}
document.querySelectorAll("[data-set-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.setMode)));
setMode(store.get("mdshare_mode") || (window.innerWidth < 800 ? "edit" : "both"));

// ---------- Scroll sync (editor → preview, proportional) ----------
view.scrollDOM.addEventListener("scroll", () => {
  if (main.dataset.mode !== "both") return;
  const s = view.scrollDOM;
  const ratio = s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
  const p = $("#preview-wrap");
  p.scrollTop = ratio * (p.scrollHeight - p.clientHeight);
}, { passive: true });

// ---------- Buttons ----------
$("#download").addEventListener("click", () => {
  const blob = new Blob([ytext.toString()], { type: "text/markdown" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${$("#title").textContent.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || noteId}.md` });
  a.click(); URL.revokeObjectURL(a.href);
});
function flash(text) {
  const t = $("#toast"); t.textContent = text; t.hidden = false;
  clearTimeout(flash.t); flash.t = setTimeout(() => (t.hidden = true), 1800);
}

// ---------- AI rephrase ----------
// The server only returns a suggestion. Replacing goes through CodeMirror → yCollab → Yjs like any
// other edit, so it syncs to everyone and Ctrl+Z undoes it. Yjs relative positions keep track of the
// selection while other people type elsewhere in the note.
const ai = {
  panel: $("#ai-panel"), status: $("#ai-status"), result: $("#ai-result"), request: $("#ai-request"),
  replace: $("#ai-replace"), retry: $("#ai-retry"), job: null, seq: 0,
};
fetch("/api/ai").then((r) => (r.ok ? r.json() : {})).then((s) => { $("#rephrase").hidden = !s.rephrase; }).catch(() => {});

function aiStatus(text, bad = false) { ai.status.textContent = text; ai.status.className = bad ? "ai-status-bad" : "muted"; }
function selectionRange() {
  const job = ai.job; if (!job) return null;
  const from = Y.createAbsolutePositionFromRelativePosition(job.start, ydoc);
  const to = Y.createAbsolutePositionFromRelativePosition(job.end, ydoc);
  return from && to ? { from: from.index, to: to.index } : null;
}
async function requestRephrase() {
  const seq = ++ai.seq;
  ai.replace.disabled = true; ai.retry.disabled = true; ai.result.value = "";
  aiStatus("Rewriting…");
  try {
    const r = await fetch("/api/rephrase", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ai.job.original, request: ai.request.value }),
    });
    const body = await r.json().catch(() => ({}));
    if (seq !== ai.seq || !ai.job) return; // cancelled or superseded
    if (!r.ok) return aiStatus(body.error || `Failed (${r.status})`, true);
    ai.result.value = body.text;
    ai.replace.disabled = false;
    aiStatus("Ready");
  } catch {
    if (seq === ai.seq) aiStatus("Couldn't reach the server.", true);
  } finally {
    if (seq === ai.seq) ai.retry.disabled = false;
  }
}
function openRephrase() {
  const { from, to } = view.state.selection.main;
  if (from === to) return flash("Select some text to rephrase first");
  ai.job = {
    original: ytext.toString().slice(from, to),
    start: Y.createRelativePositionFromTypeIndex(ytext, from),      // sticks to the first selected char
    end: Y.createRelativePositionFromTypeIndex(ytext, to, -1),      // sticks to the last selected char
  };
  ai.request.value = "";
  ai.panel.hidden = false;
  requestRephrase();
}
function closeRephrase() { ai.job = null; ai.seq++; ai.panel.hidden = true; view.focus(); }
function applyRephrase() {
  const range = selectionRange();
  if (!range || ytext.toString().slice(range.from, range.to) !== ai.job.original) {
    return aiStatus("Someone changed that text meanwhile. Select it again and retry.", true);
  }
  const insert = ai.result.value;
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from, head: range.from + insert.length } });
  closeRephrase();
  flash("Replaced · Ctrl+Z to undo");
}
$("#rephrase").addEventListener("click", openRephrase);
ai.retry.addEventListener("click", requestRephrase);
ai.replace.addEventListener("click", applyRephrase);
$("#ai-cancel").addEventListener("click", closeRephrase);
ai.request.addEventListener("keydown", (e) => { if (e.key === "Enter") requestRephrase(); });
ai.panel.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRephrase(); });

// ---------- Formatting toolbar ----------
// Every command is an ordinary CodeMirror change, so it syncs through Yjs and Ctrl+Z undoes it.
const PREFIX_RE = /^(\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)*)(.*)$/;
// Wrap each line's text, keeping Markdown line prefixes (#, -, 1., >) and outer spaces outside the markers
function wrapLines(text, open, close) {
  return text.split("\n").map((line) => {
    const [, prefix, rest] = line.match(PREFIX_RE);
    const [, lead, core, trail] = rest.match(/^(\s*)(.*?)(\s*)$/);
    return core ? prefix + lead + open + core + close + trail : line;
  }).join("\n");
}
function toggleInline(v, open, close = open, placeholder = "text") {
  const doc = v.state.doc;
  v.dispatch(v.state.changeByRange((r) => {
    if (r.empty) {
      return { changes: { from: r.from, insert: open + placeholder + close },
        range: EditorSelection.range(r.from + open.length, r.from + open.length + placeholder.length) };
    }
    if (doc.sliceString(r.from - open.length, r.from) === open && doc.sliceString(r.to, r.to + close.length) === close) {
      return { changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }],
        range: EditorSelection.range(r.from - open.length, r.to - open.length) };
    }
    const text = doc.sliceString(r.from, r.to);
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    const out = wrapLines(text, open, close);
    return { changes: { from: r.from, to: r.to, insert: out }, range: EditorSelection.range(r.from, r.from + out.length) };
  }), { userEvent: "input.format", scrollIntoView: true });
  v.focus();
  return true;
}
function setLinePrefix(v, kind) {
  const doc = v.state.doc, seen = new Set(), lines = [];
  for (const r of v.state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) if (!seen.has(n)) { seen.add(n); lines.push(doc.line(n)); }
  }
  const level = { h1: 1, h2: 2, h3: 3 }[kind];
  const family = level ? /^#{1,6}\s+/ : kind === "quote" ? /^>\s?/ : /^([-*+]|\d+[.)])\s+/;
  const has = (body) => level ? (body.match(/^(#{1,6})\s/)?.[1].length === level)
    : kind === "quote" ? /^>/.test(body) : kind === "ul" ? /^[-*+]\s/.test(body) : /^\d+[.)]\s/.test(body);
  const parts = lines.map((line) => { const ws = line.text.match(/^\s*/)[0]; return { line, ws, body: line.text.slice(ws.length) }; });
  const filled = parts.filter((p) => p.body.trim() || parts.length === 1);
  const allHave = filled.length > 0 && filled.every((p) => has(p.body));
  const changes = filled.map((p, i) => {
    const existing = p.body.match(family)?.[0] || "";
    const prefix = allHave ? "" : level ? "#".repeat(level) + " " : kind === "quote" ? "> " : kind === "ul" ? "- " : `${i + 1}. `;
    const from = p.line.from + p.ws.length;
    return { from, to: from + existing.length, insert: prefix };
  });
  v.dispatch({ changes, userEvent: "input.format" });
  v.focus();
  return true;
}
// Insert a block (code, equation, table…) on its own lines, selecting the part to type over
function insertBlock(v, before, after, placeholder) {
  const r = v.state.selection.main, doc = v.state.doc;
  const text = r.empty ? placeholder : doc.sliceString(r.from, r.to);
  const pre = r.from > 0 && doc.sliceString(r.from - 1, r.from) !== "\n" ? "\n" : "";
  const post = r.to < doc.length && doc.sliceString(r.to, r.to + 1) !== "\n" ? "\n" : "";
  const start = r.from + pre.length + before.length;
  v.dispatch({ changes: { from: r.from, to: r.to, insert: pre + before + text + after + post },
    selection: EditorSelection.range(start, start + text.length), userEvent: "input.format", scrollIntoView: true });
  v.focus();
  return true;
}
function insertLink(v) {
  const r = v.state.selection.main, sel = v.state.sliceDoc(r.from, r.to);
  const label = sel || "link text", insert = `[${label}](https://)`;
  const select = sel ? [r.from + label.length + 3, r.from + label.length + 11] : [r.from + 1, r.from + 1 + label.length];
  v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(...select), userEvent: "input.format" });
  v.focus();
  return true;
}

// Text colour and highlight are small HTML tags inside the Markdown, so they show for everyone,
// survive download, and render in most Markdown viewers.
const COLOR_KINDS = {
  text: { open: (c) => `<span style="color:${c}">`, close: "</span>",
    before: /<span style="color:#[0-9a-fA-F]{3,8}">$/, whole: /^<span style="color:#[0-9a-fA-F]{3,8}">([\s\S]*)<\/span>$/ },
  highlight: { open: (c) => `<mark style="background-color:${c}">`, close: "</mark>",
    before: /<mark style="background-color:#[0-9a-fA-F]{3,8}">$/, whole: /^<mark style="background-color:#[0-9a-fA-F]{3,8}">([\s\S]*)<\/mark>$/ },
};
const TEXT_COLORS = [["Red", "#e5484d"], ["Orange", "#f76b15"], ["Amber", "#d29a00"], ["Green", "#30a46c"], ["Teal", "#12a594"],
  ["Blue", "#0090ff"], ["Indigo", "#3e63dd"], ["Purple", "#8e4ec6"], ["Pink", "#d6409f"], ["Gray", "#8b8d98"]];
const HIGHLIGHTS = [["Yellow", "#fff3a3"], ["Lime", "#dcf5a8"], ["Green", "#c6f0d6"], ["Cyan", "#c4eff5"], ["Blue", "#d0e3ff"],
  ["Purple", "#e4d8ff"], ["Pink", "#ffd6e8"], ["Red", "#ffd6d2"], ["Orange", "#ffdfbf"], ["Gray", "#e4e6ea"]];
const lastColor = (kind) => store.get(`mdshare_last_${kind}`) || (kind === "text" ? TEXT_COLORS[0][1] : HIGHLIGHTS[0][1]);

function setColor(v, kind, color) { // color = "#rrggbb", or null to remove
  const K = COLOR_KINDS[kind], doc = v.state.doc;
  let changed = false;
  const spec = v.state.changeByRange((r) => {
    const openTag = doc.sliceString(Math.max(0, r.from - 60), r.from).match(K.before)?.[0];
    if (openTag && doc.sliceString(r.to, r.to + K.close.length) === K.close) { // selection is exactly a coloured run
      changed = true;
      const oFrom = r.from - openTag.length, o = color ? K.open(color) : "";
      return { changes: [{ from: oFrom, to: r.from, insert: o }, ...(color ? [] : [{ from: r.to, to: r.to + K.close.length }])],
        range: EditorSelection.range(oFrom + o.length, r.to - openTag.length + o.length) };
    }
    const text = doc.sliceString(r.from, r.to), whole = text.match(K.whole);
    if (whole) { // selection includes the tags
      changed = true;
      const insert = color ? K.open(color) + whole[1] + K.close : whole[1];
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(r.from, r.from + insert.length) };
    }
    if (!color || r.empty) return { range: r };
    changed = true;
    const out = wrapLines(text, K.open(color), K.close);
    return { changes: { from: r.from, to: r.to, insert: out }, range: EditorSelection.range(r.from, r.from + out.length) };
  });
  if (!changed) { flash(color ? "Select some text first" : "No colour to remove here"); return true; }
  v.dispatch({ ...spec, userEvent: "input.format" });
  if (color) { store.set(`mdshare_last_${kind}`, color); paintSwatches(); }
  v.focus();
  return true;
}
function paintSwatches() {
  $("#swatch-text").style.setProperty("--swatch", lastColor("text"));
  $("#swatch-highlight").style.setProperty("--swatch", lastColor("highlight"));
}

function formattingKeys() {
  return [
    { key: "Mod-b", run: (v) => toggleInline(v, "**") },
    { key: "Mod-i", run: (v) => toggleInline(v, "*") },
    { key: "Mod-Shift-x", run: (v) => toggleInline(v, "~~") },
    { key: "Mod-e", run: (v) => toggleInline(v, "`", "`", "code") },
    { key: "Mod-k", run: insertLink },
    { key: "Mod-Shift-h", run: (v) => setColor(v, "highlight", lastColor("highlight")) },
  ];
}
const COMMANDS = {
  undo: () => undoManager.undo(), redo: () => undoManager.redo(),
  h1: (v) => setLinePrefix(v, "h1"), h2: (v) => setLinePrefix(v, "h2"), h3: (v) => setLinePrefix(v, "h3"),
  bold: (v) => toggleInline(v, "**"), italic: (v) => toggleInline(v, "*"), strike: (v) => toggleInline(v, "~~"),
  code: (v) => toggleInline(v, "`", "`", "code"), link: insertLink,
  quote: (v) => setLinePrefix(v, "quote"), ul: (v) => setLinePrefix(v, "ul"), ol: (v) => setLinePrefix(v, "ol"),
  table: (v) => insertBlock(v, "\n| ", " | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n", "Column 1"),
  codeblock: (v) => insertBlock(v, "```\n", "\n```", "code"),
  math: (v) => toggleInline(v, "$", "$", "x"),
  mathblock: (v) => insertBlock(v, "$$\n", "\n$$", "E = mc^2"),
  hr: (v) => { v.dispatch(v.state.update({ selection: { anchor: v.state.selection.main.to } })); return insertBlock(v, "\n---\n", "", ""); },
};
const toolbar = $(".toolbar");
toolbar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // keep the editor's selection
toolbar.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.pop) return togglePopover(b);
  const cmd = COMMANDS[b.dataset.cmd];
  if (cmd) { closePopover(); cmd(view); view.focus(); }
});

// ---------- Popovers (colours, appearance) ----------
let openPop = null;
function togglePopover(btn) {
  const pop = $(`#${btn.dataset.pop}`);
  if (openPop === pop) return closePopover();
  closePopover();
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${r.bottom + 6}px`;
  btn.setAttribute("aria-expanded", "true");
  openPop = pop; pop._btn = btn;
}
function closePopover() {
  if (!openPop) return;
  openPop.hidden = true; openPop._btn.setAttribute("aria-expanded", "false"); openPop = null;
}
document.addEventListener("mousedown", (e) => {
  if (openPop && !openPop.contains(e.target) && !openPop._btn.contains(e.target)) closePopover();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openPop) { closePopover(); view.focus(); } });
addEventListener("resize", closePopover);

for (const [kind, list] of [["text", TEXT_COLORS], ["highlight", HIGHLIGHTS]]) {
  const grid = $(`.swatches[data-kind="${kind}"]`);
  for (const [name, hex] of list) {
    const b = Object.assign(document.createElement("button"), { className: `sw${kind === "text" ? " text-sw" : ""}`, title: name, textContent: kind === "text" ? "A" : "" });
    b.style.setProperty("--c", hex);
    b.setAttribute("aria-label", `${kind === "text" ? "Text colour" : "Highlight"} ${name}`);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => { closePopover(); setColor(view, kind, hex); });
    grid.append(b);
  }
  $(`#custom-${kind}`).addEventListener("change", (e) => { closePopover(); setColor(view, kind, e.target.value); });
}
document.querySelectorAll("[data-clear]").forEach((b) => {
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => { closePopover(); setColor(view, b.dataset.clear, null); });
});
paintSwatches();

// Appearance: personal fonts, size, theme, page width (public/theme.js stores and applies them)
const prefs = window.mdsharePrefs;
if (prefs) {
  for (const id of ["ap-editor-font", "ap-preview-font"]) {
    const sel = $(`#${id}`), key = id === "ap-editor-font" ? "editorFont" : "previewFont";
    for (const [value, f] of Object.entries(prefs.FONTS)) sel.append(new Option(f.label, value));
    sel.value = prefs.get()[key];
    sel.addEventListener("change", () => { prefs.set({ [key]: sel.value }); view.requestMeasure(); });
  }
  for (const [id, key] of [["ap-size", "size"], ["ap-theme", "theme"], ["ap-width", "width"]]) {
    const group = $(`#${id}`);
    const mark = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === prefs.get()[key])));
    group.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      prefs.set({ [key]: b.dataset.v }); mark(); view.requestMeasure();
    });
    mark();
  }
}
$("#appearance-btn").addEventListener("click", (e) => togglePopover(e.currentTarget));

// ---------- Share dialog ----------
// Owners choose the link setting and add people by email; everyone else sees their own access.
const share = {
  pop: $("#pop-share"), url: $("#share-url"), mode: $("#share-mode"), people: $("#share-people"),
  info: $("#share-info"), error: $("#share-error"), ownerUi: $("#share-owner-ui"), email: $("#share-email"), role: $("#share-role"),
};
const ROLE_TEXT = { viewer: "Can view", editor: "Can edit", owner: "Owner" };
share.url.value = location.href;
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function shareError(msg) { share.error.textContent = msg || ""; share.error.hidden = !msg; }
function renderShare(info) {
  shareError("");
  const isOwner = info.role === "owner" && !info.local;
  share.ownerUi.hidden = !isOwner;
  if (info.local) {
    share.info.textContent = "Sign-in isn't set up on this server, so sharing with people is off. Anyone who can open Labbook here can open this link.";
    return;
  }
  const domains = info.domains.map((d) => "@" + d).join(", ");
  if (!isOwner) {
    const owner = info.owner ? ` Owner: ${info.owner.email}.` : "";
    share.info.textContent = `You can ${info.role === "viewer" ? "view" : "edit"} this note.${owner} Only owners can change who has access.`;
    return;
  }
  share.info.textContent = "";
  share.mode.value = info.share_mode;
  $("#share-domains").textContent = `"Anyone signed in" means anyone with a ${domains} address.`;
  share.email.placeholder = `name@${info.domains[0] || "your-university.edu"}`;
  share.people.replaceChildren();
  if (info.owner) {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { className: "who", textContent: info.owner.email + (info.owner.you ? " (you)" : "") }),
      Object.assign(document.createElement("span"), { className: "muted", textContent: "Owner" }));
    share.people.append(li);
  }
  for (const m of info.members || []) {
    const li = document.createElement("li");
    const who = Object.assign(document.createElement("span"), { className: "who", textContent: m.email });
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", `Role for ${m.email}`);
    for (const r of ["viewer", "editor", "owner"]) sel.append(new Option(ROLE_TEXT[r], r, false, r === m.role));
    sel.addEventListener("change", () => api("PATCH", `/api/notes/${noteId}/members/${m.user_id}`, { role: sel.value })
      .then(renderShare, (e) => shareError(e.message)));
    const rm = Object.assign(document.createElement("button"), { type: "button", className: "ghost small", textContent: "Remove" });
    rm.setAttribute("aria-label", `Remove ${m.email}`);
    rm.addEventListener("click", () => api("DELETE", `/api/notes/${noteId}/members/${m.user_id}`)
      .then((d) => (d.removed ? closePopover() : renderShare(d)), (e) => shareError(e.message)));
    li.append(who, sel, rm);
    share.people.append(li);
  }
}
$("#share").addEventListener("click", (e) => {
  togglePopover(e.currentTarget);
  if (openPop === share.pop) api("GET", `/api/notes/${noteId}`).then(renderShare, (err) => shareError(err.message));
});
$("#share-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); flash("Link copied"); }
  catch { share.url.select(); flash("Press Ctrl+C to copy"); }
});
share.mode.addEventListener("change", () => api("PUT", `/api/notes/${noteId}/share`, { share_mode: share.mode.value })
  .then((d) => { renderShare(d); flash("Sharing updated"); }, (e) => shareError(e.message)));
$("#share-add").addEventListener("submit", (e) => {
  e.preventDefault();
  api("POST", `/api/notes/${noteId}/members`, { email: share.email.value, role: share.role.value })
    .then((d) => { share.email.value = ""; renderShare(d); flash("Added"); }, (err) => shareError(err.message));
});

// For tests / debugging
window.__mdshare = { ytext, provider, view };
