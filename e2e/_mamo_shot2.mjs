import { chromium } from 'playwright';
const [url, out, w, h] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: +(w||1440), height: +(h||950) } })).newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: out });
await b.close();
