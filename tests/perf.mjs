import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 820 });
await page.goto(process.argv[2] ?? 'http://localhost:5200/', { waitUntil: 'networkidle0' });
const t0 = Date.now();
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('勤務開始')), { timeout: 120000 });
console.log('world loaded', Date.now() - t0, 'ms');
const t1 = Date.now();
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('勤務開始')).click());
await page.waitForFunction(() => !!window.__map, { timeout: 60000 });
console.log('map created', Date.now() - t1);
const seen = new Set();
for (let i = 0; i < 120; i++) {
  const st = await page.evaluate(() => { const m = window.__map; return Object.keys(m.getStyle().sources).filter((k) => m.isSourceLoaded(k)); });
  for (const s of st) if (!seen.has(s)) { seen.add(s); console.log('  ', s, Date.now() - t1); }
  if (seen.size >= 15) break;
  await new Promise((r) => setTimeout(r, 250));
}
await browser.close();
