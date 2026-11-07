// Playwright template for checking the local clay-base app on a Starfolk box, run ON the box.
// Copy it into <worktree>/apps/frontend/ (so `@playwright/test` resolves), edit the CHECKS section,
// run `node ./verify.tmp.mjs`, then delete it. Screenshots land in /tmp/shot-<name>.png.
//
// Env: BOX_HOST (default: `hostname -f`), TS_IP (default: `tailscale ip -4`), URLS (JSON
// {name: url}, optional).
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const host = process.env.BOX_HOST ?? execSync('hostname -f').toString().trim();
const tsIp = process.env.TS_IP ?? execSync('tailscale ip -4').toString().trim();
const urls = JSON.parse(process.env.URLS ?? '{}');

// The repo's Playwright version may want a browser build that isn't downloaded; use whatever is.
const cache = `${process.env.HOME}/.cache/ms-playwright`;
const chromiumDir = readdirSync(cache).find((dir) => /^chromium-\d+$/.test(dir));
const executablePath = `${cache}/${chromiumDir}/chrome-linux64/chrome`;

const browser = await chromium.launch({
  executablePath,
  // Without this the box hostname resolves to loopback and API calls fail with ERR_SSL_PROTOCOL_ERROR.
  args: [`--host-resolver-rules=MAP ${host} ${tsIp}`],
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
// ERR_ABORTED is a navigation cancelling in-flight calls; ERR_FAILED usually means a missing starfolk-local config.
page.on('requestfailed', (request) => {
  const error = request.failure()?.errorText;
  if (request.url().includes(':3001') && error !== 'net::ERR_ABORTED') console.log('API FAILED', request.url().slice(0, 120), error);
});

await page.goto(`https://${host}:8090/login`);
await page.getByPlaceholder('Email address').fill('devs@clay.com');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByPlaceholder('Password').fill('claytest');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });

// --- CHECKS: replace with what the change needs ---
for (const [name, url] of Object.entries(urls)) {
  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  await page.screenshot({ path: `/tmp/shot-${name}.png` });
  console.log(JSON.stringify({ name, url: page.url().slice(0, 120) }));
}
// --- end CHECKS ---

await browser.close();
