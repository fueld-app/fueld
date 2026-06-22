// WCAG contrast audit of Fueld design tokens (light + dark).
// Computes relative luminance + contrast ratios for the key text/UI pairs.
// Translucent backgrounds (status pills) are composited over --surface first.
const hex = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
};
const rgba = (str) => {
  const m = str.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] === undefined ? 1 : p[3] };
};
const lum = ([r, g, b]) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
// Composite translucent rgba over an opaque surface (rgb array).
const composite = (bg, surface) => [
  bg.a * bg.r + (1 - bg.a) * surface[0],
  bg.a * bg.g + (1 - bg.a) * surface[1],
  bg.a * bg.b + (1 - bg.a) * surface[2],
];

const THEMES = {
  dark: {
    surface: hex('#0f1421'), bg: hex('#06080d'), bg2: hex('#0a0e16'),
    ink: hex('#f3f5fa'), inkDim: hex('#c7cdda'), muted: hex('#8a93a6'),
    accent: hex('#f59e0b'), accent2: hex('#fbbf24'), cyan: hex('#22d3ee'), emerald: hex('#34d399'),
    brand600: hex('#d97706'), brand500: hex('#f59e0b'), white: hex('#ffffff'),
    line: rgba('rgba(255,255,255,0.08)').a, lineStr: rgba('rgba(255,255,255,0.16)'),
  },
  light: {
    surface: hex('#ffffff'), bg: hex('#f6f7fb'), bg2: hex('#eef1f7'),
    ink: hex('#0f1421'), inkDim: hex('#3f4658'), muted: hex('#6b7385'),
    accent: hex('#f59e0b'), accent2: hex('#fbbf24'), cyan: hex('#22d3ee'), emerald: hex('#34d399'),
    brand600: hex('#d97706'), brand500: hex('#f59e0b'), white: hex('#ffffff'),
  },
};

// (label, fg, bg, threshold) — threshold 4.5 = normal text, 3.0 = large/UI/border
const checks = (t) => [
  ['body: ink on surface', t.ink, t.surface, 4.5],
  ['body: ink on bg', t.ink, t.bg, 4.5],
  ['body: ink on bg-2', t.ink, t.bg2, 4.5],
  ['secondary: ink-dim on surface', t.inkDim, t.surface, 4.5],
  ['tertiary: muted on surface', t.muted, t.surface, 4.5],
  ['tertiary: muted on bg-2', t.muted, t.bg2, 4.5],
  ['link/accent: accent on surface', t.accent, t.surface, 4.5],
  ['link/accent: accent-2 on surface', t.accent2, t.surface, 4.5],
  ['btn primary: white on brand-600', t.white, t.brand600, 4.5],
  ['btn primary dark: white on brand-500', t.white, t.brand500, 4.5],
  ['focus ring: brand-500 on surface (UI)', t.brand500, t.surface, 3.0],
  ['border: line-strong on surface (UI)', null, null, 3.0], // handled specially
];

const statusPills = {
  dark: {
    surface: hex('#0f1421'),
    pills: {
      inquiry: ['rgba(245,158,11,0.12)', '#fbbf24'],
      offer: ['rgba(249,115,22,0.14)', '#fb923c'],
      confirmed: ['rgba(34,211,238,0.12)', '#22d3ee'],
      delivered: ['rgba(139,92,246,0.14)', '#a78bfa'],
      invoiced: ['rgba(99,102,241,0.14)', '#818cf8'],
      paid: ['rgba(52,211,153,0.12)', '#34d399'],
      cancelled: ['rgba(239,68,68,0.12)', '#f87171'],
      overdue: ['rgba(220,38,38,0.16)', '#fca5a5'],
      draft: ['rgba(255,255,255,0.05)', '#8a93a6'],
      void: ['rgba(255,255,255,0.04)', '#8a93a6'],
      sent: ['rgba(59,130,246,0.14)', '#60a5fa'],
      'partially-paid': ['rgba(245,158,11,0.12)', '#fbbf24'],
    },
  },
  light: {
    surface: hex('#ffffff'),
    pills: {
      inquiry: ['rgba(245,158,11,0.12)', '#b45309'],
      offer: ['rgba(249,115,22,0.12)', '#c2410c'],
      confirmed: ['rgba(34,211,238,0.12)', '#0e7490'],
      delivered: ['rgba(139,92,246,0.10)', '#7c3aed'],
      invoiced: ['rgba(99,102,241,0.10)', '#4f46e5'],
      paid: ['rgba(5,150,105,0.10)', '#047857'],
      cancelled: ['rgba(239,68,68,0.10)', '#b91c1c'],
      overdue: ['rgba(220,38,38,0.12)', '#991b1b'],
      draft: ['rgba(15,20,35,0.05)', '#6b7385'],
      void: ['rgba(15,20,35,0.04)', '#6b7385'],
      sent: ['rgba(59,130,246,0.12)', '#1d4ed8'],
      'partially-paid': ['rgba(245,158,11,0.12)', '#b45309'],
    },
  },
};

let fail = 0;
for (const [name, t] of Object.entries(THEMES)) {
  console.log(`\n=== ${name.toUpperCase()} ===`);
  for (const [label, fg, bg, thr] of checks(t)) {
    if (!fg) continue;
    const r = contrast(fg, bg);
    const ok = r >= thr;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:${thr}  ${label}`);
  }
  // line-strong border contrast vs surface (3:1 UI boundary)
  const ls = name === 'dark' ? rgba('rgba(255,255,255,0.16)') : rgba('rgba(15,20,35,0.16)');
  const lsEff = composite(ls, t.surface);
  const r = contrast(lsEff, t.surface);
  const ok = r >= 3.0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:3.0  border: line-strong on surface (UI)`);

  console.log(`  -- status pills (fg on composited bg over surface; pill text is bold ~11px → 4.5:1 normal-text, 3.0:1 large/UI) --`);
  for (const [status, [bgStr, fgHex]] of Object.entries(statusPills[name].pills)) {
    const eff = composite(rgba(bgStr), statusPills[name].surface);
    const cr = contrast(hex(fgHex), eff);
    const ok45 = cr >= 4.5, ok30 = cr >= 3.0;
    if (!ok30) fail++;
    console.log(`${ok45 ? 'PASS(4.5)' : ok30 ? 'pass(3.0)' : 'FAIL'}  ${cr.toFixed(2)}  ${status}  (${fgHex} on ${bgStr}→surface)`);
  }
}
console.log(`\n=== TOTAL FAILS (below 3.0): ${fail} ===`);