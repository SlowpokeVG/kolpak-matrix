#!/usr/bin/env node
// Kolpak: renders the Android launcher, adaptive, monochrome and notification icons from
// AI/logo.svg (the Guy) and src-tauri/icons/kolpak-icon.svg (the Guy on the paper square)
// into src-tauri/icons/android, which gen/android/app/src/main/res links to.
//
// Needs Playwright with a Chromium build (`require('playwright')`). Run from the repo root:
//   node scripts/icons/render-android-icons.mjs
// Re-run only when the logo changes; the PNGs are committed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = process.cwd();
const out = path.join(root, 'src-tauri', 'icons', 'android');
const guy = readFileSync(path.join(root, 'AI', 'logo.svg'), 'utf8');
const tile = readFileSync(path.join(root, 'src-tauri', 'icons', 'kolpak-icon.svg'), 'utf8');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// fit: share of the canvas the image's longer side takes. silhouette: white on transparent.
// round: clip to a circle (legacy round launcher icon).
function page(svg, size, { fit = 1, silhouette = false, round = false } = {}) {
  const box = Math.round(size * fit);
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    .c{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
       overflow:hidden;${round ? 'border-radius:50%;' : ''}}
    img{max-width:${box}px;max-height:${box}px;width:${box}px;height:${box}px;object-fit:contain;
        ${silhouette ? 'filter:brightness(0) invert(1);' : ''}}
  </style></head><body><div class="c"><img src="${dataUrl(svg)}"></div></body></html>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();

async function render(file, svg, size, opts) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(page(svg, size, opts));
  await p.waitForFunction(() => [...document.images].every((i) => i.complete));
  const png = await p.locator('.c').screenshot({ omitBackground: true });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
}

for (const [name, scale] of Object.entries(densities)) {
  const dir = path.join(out, `mipmap-${name}`);
  // Legacy launcher icons (pre-Android 8): the paper tile, 48 dp.
  await render(path.join(dir, 'ic_launcher.png'), tile, 48 * scale);
  await render(path.join(dir, 'ic_launcher_round.png'), tile, 48 * scale, { round: true });
  // Adaptive layers, 108 dp. The XML insets them by 16.5%, so the image is the visible part:
  // the Guy, kept inside the 66 dp safe circle.
  await render(path.join(dir, 'ic_launcher_foreground.png'), guy, 108 * scale, { fit: 0.76 });
  await render(path.join(dir, 'ic_launcher_adaptive_foreground.png'), guy, 108 * scale, {
    fit: 0.76,
    silhouette: true,
  });
  // Status-bar notification icon, 24 dp, white on transparent.
  await render(path.join(dir, 'ic_notification.png'), guy, 24 * scale, {
    fit: 0.92,
    silhouette: true,
  });
}

await browser.close();
console.log(`Android icons written to ${path.relative(root, out)}`);
