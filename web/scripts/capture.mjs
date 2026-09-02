import { chromium } from "playwright-core";
const exe = process.env.CHROME;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const measureJs = `(() => { const ol = document.querySelector('ol'); if (!ol) return null; const top = ol.getBoundingClientRect().top; const glyphs = [...ol.querySelectorAll('[data-node] > [data-glyph]')].map(g => { const r = g.getBoundingClientRect(); return Math.round(r.top - top + r.height/2); }); const paths = [...document.querySelectorAll('svg path')].filter(p => p.getAttribute('d')?.startsWith('M 19')).map(p => p.getAttribute('d')); return { width: innerWidth, glyphs, paths }; })()`;
const shots = [
  ["/", 390, 1300, "mobile.png"], ["/", 1440, 900, "desktop.png"],
  ["/settings", 1440, 1000, "desktop-settings.png"], ["/credentials", 390, 1200, "mobile-credentials.png"],
  ["/credentials", 1440, 900, "desktop-credentials.png"], ["/settings", 390, 3300, "mobile-settings.png"],
  ["/sign-in", 1440, 700, "desktop-sign-in.png"],
];
for (const [path, w, h, file] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (path === "/") console.log(file, JSON.stringify(await page.evaluate(measureJs)));
  await page.screenshot({ path: `.impeccable/review/${file}`, fullPage: false });
  await page.close();
}
await browser.close();
