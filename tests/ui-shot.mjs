// UI smoke test: drives the app in headless Chrome and captures screenshots.
// Usage: node tests/ui-shot.mjs [url] [scenario]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5199/';
const scenario = process.argv[3] ?? 'basic';
const out = 'tests/shots';
fs.mkdirSync(out, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--lang=ja-JP'],
});
const errors = [];
async function open(w, h, touch = true, theme = 'dark') {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: touch, isMobile: w < 700 });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('opd-ui', JSON.stringify({ theme: t }));
    localStorage.removeItem('opd-save-v1');
  }, theme);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (page, text, sel = 'button') => {
  const ok = await page.evaluate(
    (text, sel) => {
      const el = [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().includes(text));
      if (el) el.click();
      return !!el;
    },
    text,
    sel,
  );
  if (!ok) errors.push(`missing ${sel} "${text}"`);
  return ok;
};

async function start(page, hour = '19:00 夜') {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('勤務開始')), { timeout: 120000 });
  await clickText(page, hour);
  await clickText(page, '繁忙');
  await clickText(page, '勤務開始');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
  await sleep(4000);
}

if (scenario === 'basic' || scenario === 'all') {
  const page = await open(1180, 820);
  await page.screenshot({ path: `${out}/00-start.png` });
  await start(page);
  // speed up so incidents appear
  await clickText(page, '×8');
  await sleep(9000);
  await page.screenshot({ path: `${out}/01-console-dark.png` });
  // select first incident & open dispatch
  await page.evaluate(() => document.querySelector('.dock-left .row')?.click());
  await sleep(1500);
  await page.screenshot({ path: `${out}/02-incident.png` });
  await clickText(page, '部隊選定・出動指令');
  await sleep(2500);
  await page.screenshot({ path: `${out}/03-dispatch.png` });
  await page.evaluate(() => [...document.querySelectorAll('.action-bar .btn.primary')].pop()?.click());
  await sleep(6000);
  await page.screenshot({ path: `${out}/04-after-dispatch.png` });
  // units tab
  await clickText(page, '部隊', '.tab');
  await sleep(800);
  await page.evaluate(() => document.querySelectorAll('.dock-left .row')[0]?.click());
  await sleep(1500);
  await page.screenshot({ path: `${out}/05-unit.png` });
  // light theme
  await page.evaluate(() => document.querySelector('button[title="ライト／ダーク切替"]')?.click());
  await sleep(2500);
  await page.screenshot({ path: `${out}/06-light.png` });
  // collapse panels
  await page.evaluate(() => document.querySelectorAll('.dock-handle').forEach((b) => b.click()));
  await sleep(1000);
  await page.screenshot({ path: `${out}/07-collapsed.png` });
  await page.close();
}

if (scenario === 'phone' || scenario === 'all') {
  const page = await open(390, 844, true, 'dark');
  await start(page);
  await sleep(3000);
  await page.screenshot({ path: `${out}/10-phone.png` });
  await page.evaluate(() => document.querySelector('.sheet .tab')?.click());
  await sleep(1500);
  await page.screenshot({ path: `${out}/11-phone-list.png` });
  await page.close();
}

if (scenario === 'drive' || scenario === 'all') {
  const page = await open(1180, 820);
  await start(page, '13:00 昼');
  await clickText(page, '部隊', '.tab');
  await sleep(600);
  await page.evaluate(() => document.querySelectorAll('.dock-left .row')[0]?.click());
  await sleep(800);
  await clickText(page, 'この車両を運転する');
  await sleep(9000);
  await page.screenshot({ path: `${out}/20-drive.png` });
  // accelerate with keyboard
  await page.keyboard.down('ArrowUp');
  await sleep(4000);
  await page.keyboard.up('ArrowUp');
  await sleep(500);
  await page.screenshot({ path: `${out}/21-drive-moving.png` });
  await clickText(page, '車外視点');
  await sleep(1500);
  await page.screenshot({ path: `${out}/22-drive-chase.png` });
  await clickText(page, '指令台');
  await sleep(2000);
  await page.screenshot({ path: `${out}/23-back.png` });
  await page.close();
}

await browser.close();
console.log(errors.length ? errors.slice(0, 40).join('\n') : 'no console errors');
