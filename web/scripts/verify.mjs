// verification round: captures + measurements against the dev server
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
const exe = process.env.CHROME;
const base = "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const out = {};

async function fresh(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  return { page, errors };
}

// captures
const shots = [["/", 1440, 900, "desktop.png"], ["/", 390, 1200, "mobile.png"], ["/settings", 1440, 1100, "desktop-settings.png"], ["/settings", 390, 2600, "mobile-settings.png"], ["/credentials", 1440, 700, "desktop-credentials.png"], ["/credentials", 390, 900, "mobile-credentials.png"]];
for (const [path, w, h, file] of shots) {
  const { page } = await fresh({ viewport: { width: w, height: h } });
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `.impeccable/review/${file}` });
  await page.close();
}
{
  const { page } = await fresh({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.screenshot({ path: ".impeccable/review/desktop-dark.png" }); await page.close();
}

// hydration / console errors per page
for (const path of ["/", "/settings", "/credentials"]) {
  const { page, errors } = await fresh();
  await page.goto(base + path, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  out[`errors ${path}`] = errors;
  await page.close();
}

// tab switch timing + requests
{
  const { page } = await fresh();
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const timings = [];
  const seq = [["Settings", "h2:has-text('Review policy')"], ["Credentials", "h2:has-text('Codex subscription')"], ["Runs", "[data-node]"], ["Settings", "h2:has-text('Review policy')"], ["Runs", "[data-node]"], ["Credentials", "h2:has-text('Codex subscription')"], ["Runs", "[data-node]"]];
  for (const [tab, marker] of seq) {
    const reqs = [];
    const onReq = (r) => { const u = r.url(); if (!u.includes("/@") && !u.includes("node_modules") && !u.includes("?import")) reqs.push(u.replace(base, "")); };
    page.on("request", onReq);
    const t0 = Date.now();
    await page.click(`nav a:has-text('${tab}')`);
    await page.waitForSelector(marker, { state: "attached", timeout: 10000 });
    const dt = Date.now() - t0;
    await page.waitForTimeout(300);
    page.off("request", onReq);
    timings.push({ tab, ms: dt, requests: reqs.filter(u => !u.endsWith(".js") && !u.endsWith(".css") && !u.includes(".tsx")).slice(0, 5) });
  }
  out.tabSwitches = timings;
  await page.close();
}

// mobile overflow + tap targets + lanes
{
  const { page } = await fresh({ viewport: { width: 390, height: 1200 } });
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  out.mobile = await page.evaluate(() => {
    const small = [...document.querySelectorAll("a,button,input,select,textarea")].map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.tagName).trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(e => e.h > 0 && (e.h < 24));
    const ol = document.querySelector("ol"); const top = ol?.getBoundingClientRect().top ?? 0;
    const glyphs = ol ? [...ol.querySelectorAll("[data-node] > [data-glyph]")].map(g => { const r = g.getBoundingClientRect(); return Math.round(r.top - top + r.height / 2); }) : [];
    const paths = [...document.querySelectorAll("svg path")].filter(p => p.getAttribute("d")?.startsWith("M 19")).map(p => p.getAttribute("d"));
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, small, glyphs, paths, headings: [...document.querySelectorAll("h1,h2")].map(h => h.tagName + ":" + h.textContent.trim().slice(0, 30)) };
  });
  await page.close();
}

// contrast of ink tiers
{
  const { page } = await fresh();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  out.contrast = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const lum = (hex) => { const c = hex.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const probe = (name) => { const el = document.createElement("div"); el.style.color = `var(${name})`; document.body.appendChild(el); const rgb = getComputedStyle(el).color; el.remove(); const m = rgb.match(/\d+/g).map(Number); return "#" + m.slice(0, 3).map(n => n.toString(16).padStart(2, "0")).join(""); };
    const sheet = probe("--color-sheet"), i2 = probe("--color-ink-2"), i3 = probe("--color-ink-3");
    const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
    return { sheet, ink2: i2, ink3: i3, "ink2:sheet": ratio(i2, sheet), "ink3:sheet": ratio(i3, sheet) };
  });
  await page.close();
}

// live reactivity: insert a run while the page is open
if (!process.env.SKIP_LIVE) {
  const { page } = await fresh();
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  const before = await page.locator("[data-node]").count();
  const elapsedBefore = await page.locator("[data-node]").first().locator("span.mono.text-ink-3").first().textContent().catch(() => null);
  execSync(`cd ../server && npx convex run runs:recordDispatch '{"owner":"ecrofaidem","repo":"monorepo","dispatchId":"verify01","kind":"review","trigger":"pull_request_opened","prNumber":2890,"prTitle":"verify: live insert reaches the rail without a reload","triggerer":"mt-mf-1","title":"prfrog: review #2890 · verify01"}'`, { stdio: "ignore" });
  await page.waitForFunction((n) => document.querySelectorAll("[data-node]").length > n, before, { timeout: 15000 }).catch(() => null);
  const after = await page.locator("[data-node]").count();
  const rowIn = await page.locator("li.row-in").count();
  await page.waitForTimeout(2300);
  const elapsedAfter = await page.locator("[data-node]").first().locator("span.mono.text-ink-3").first().textContent().catch(() => null);
  const firstTitle = await page.locator("[data-node]").first().textContent();
  out.live = { before, after, rowInDuringArrival: rowIn, elapsedThenLater: [elapsedBefore, elapsedAfter], firstRow: firstTitle.slice(0, 90) };
  await page.screenshot({ path: ".impeccable/review/desktop-live.png" });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
