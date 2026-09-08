// Mobile UI audit for Fueld staging (390x844).
// Usage: node e2e/mobile-audit.mjs --routes /a,/b --out /tmp/report.json --shots /tmp/shots --interact
// Checks per route (all elements NOT inside a horizontally scrollable ancestor):
//   clipped    — interactive elements extending past the right/left viewport edge
//   tapTargets — visible buttons/links shorter than 40px (info)
//   overlays   — full-viewport fixed layers intercepting clicks with no visible dialog (bug indicator)
// Interact mode additionally opens known dropdown triggers and audits the opened panel bounds.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes('--' + name);

const BASE = get('base', 'https://staging.fueld.app');
const EMAIL = get('email', 'cmtest@fueld.app');
const PASSWORD = get('password', 'StagingTest2026!');
const routes = (get('routes', '/') || '/').split(',').map((r) => r.trim()).filter(Boolean);
const out = get('out', '/tmp/mobile-audit.json');
const shots = get('shots', '/tmp/mobile-shots');
const interact = has('interact');

import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function login() {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  if (!page.url().includes('/login')) return; // already logged in
  await page.fill('form input >> nth=0', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(4000);
}

// ── audit helpers (injected into the page) ──────────────────────────────
const AUDIT_FN = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const inScrollableX = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
    }
    return false;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      ariaLabel: el.getAttribute('aria-label') || '',
      cls: String(el.className).split(' ').slice(0, 5).join(' '),
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  const clipped = [];
  const smallTap = [];
  for (const el of document.querySelectorAll('button, a, input, select, [role="button"], [role="tab"], textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const interactive = describe(el);
    if (r.right > vw + 2 || r.left < -2) {
      if (!inScrollableX(el)) clipped.push({ ...interactive, issue: r.right > vw + 2 ? 'clipped-right' : 'clipped-left' });
    }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && r.height < 40 && r.width > 0) {
      smallTap.push({ ...interactive, h: Math.round(r.height) });
    }
  }
  // Full-viewport fixed overlay present but no dialog/palette open → likely stuck backdrop
  const stuckOverlays = [];
  for (const el of document.querySelectorAll('div')) {
    const r = el.getBoundingClientRect();
    if (r.width >= vw - 4 && r.height >= vh - 4) {
      const s = getComputedStyle(el);
      if ((s.position === 'fixed') && parseFloat(s.opacity || '1') > 0) {
        const cls = String(el.className);
        if (cls.includes('z-40') && !cls.includes('z-50')) {
          const hasOpenPanel = !!document.querySelector('[role="dialog"], .palette, input:focus');
          if (!hasOpenPanel) stuckOverlays.push({ cls: cls.slice(0, 60) });
        }
      }
    }
  }
  return { vw, vh, clipped, smallTap: smallTap.slice(0, 12), stuckOverlays };
};

const INTERACT_TRIGGERS = [
  { name: 'filters', btn: 'button:has-text("Filters")' },
  { name: 'views', btn: 'button:has-text("Views")' },
  { name: 'columns', btn: 'button:has-text("Columns")' },
  { name: 'export', btn: 'button:has-text("Export")' },
];

const report = [];
const results = [];
await login();

for (const route of routes) {
  const entry = { route, url: '', clipped: [], smallTap: [], stuckOverlays: [], panels: [], shot: '' };
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    entry.url = page.url();
    const audit = await page.evaluate(AUDIT_FN);
    entry.clipped = audit.clipped;
    entry.smallTap = audit.smallTap;
    entry.stuckOverlays = audit.stuckOverlays;
    const slug = route === '/' ? 'root' : route.replace(/\//g, '_').replace(/^_/, '');
    entry.shot = `${shots}/${slug}.png`;
    await page.screenshot({ path: entry.shot, fullPage: true });

    if (interact) {
      for (const t of INTERACT_TRIGGERS) {
        const btn = page.locator(t.btn).first();
        if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) continue;
        try {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(600);
          const panel = await page.evaluate(() => {
            // the opened panel = topmost newly visible overlay/dropdown; approximate with the largest
            // fixed/absolute element above the trigger layer that appeared
            const vw = window.innerWidth;
            let worst = null;
            for (const el of document.querySelectorAll('div, ul')) {
              const s = getComputedStyle(el);
              if (s.position !== 'absolute' && s.position !== 'fixed') continue;
              if (s.display === 'none' || s.visibility === 'hidden') continue;
              const r = el.getBoundingClientRect();
              if (r.width < 80 || r.height < 40) continue;
              const overflowsRight = r.right > vw + 2;
              const overflowsLeft = r.left < -2;
              if (overflowsRight || overflowsLeft) {
                if (!worst || r.width > worst.w) worst = { cls: String(el.className).split(' ').slice(0, 4).join(' '), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
              }
            }
            return worst;
          });
          if (panel) entry.panels.push({ trigger: t.name, ...panel });
          const shot = `${shots}/${slug}--${t.name}.png`;
          await page.screenshot({ path: shot });
          // close: Escape then click backdrop fallback
          await page.keyboard.press('Escape');
          await page.waitForTimeout(250);
          const backdrop = page.locator('div.fixed.inset-0.z-40, div.fixed.inset-0.z-\\[60\\]').first();
          if (await backdrop.count()) await backdrop.click({ position: { x: 8, y: 8 }, force: true }).catch(() => {});
          await page.waitForTimeout(250);
        } catch { /* trigger not present on this page */ }
      }
      // re-audit after interactions (stuck backdrops etc.)
      const audit2 = await page.evaluate(AUDIT_FN);
      entry.stuckOverlays = audit.stuckOverlays.length ? audit.stuckOverlays : audit2.stuckOverlays;
      if (audit2.clipped.length && !entry.clipped.length) entry.clippedAfterInteract = audit2.clipped;
    }
  } catch (e) {
    entry.error = String(e).slice(0, 200);
  }
  if (!entry.error || entry.clipped.length || entry.panels.length) results.push(entry);
  // eslint-disable-next-line no-console
  console.error(`audited ${route}: clipped=${entry.clipped.length} panels=${entry.panels.length} stuck=${entry.stuckOverlays.length}`);
}

await browser.close();
await import('node:fs').then((fs) => fs.writeFileSync(out, JSON.stringify(results, null, 2)));
console.error('WROTE ' + out);