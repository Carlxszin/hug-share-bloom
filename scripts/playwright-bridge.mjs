// Optional Playwright bridge for Octopus.
// Run: npx playwright install chromium && node scripts/playwright-bridge.mjs
// Exposes a tiny HTTP API on http://localhost:7676 that the agent uses when
// available (falls back to fetch scraping when this server is down).
import http from "node:http";
import { chromium } from "playwright";

const PORT = 7676;
let browser;

async function getBrowser() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function withPage(url, fn) {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (req.url === "/health") return json(res, 200, { ok: true });

    if (req.url === "/navigate" && req.method === "POST") {
      const { url } = await readJson(req);
      const data = await withPage(url, async (page) => {
        const title = await page.title();
        const text = (await page.innerText("body")).slice(0, 4000);
        const shot = await page.screenshot({ fullPage: false, type: "png" });
        return { title, text, screenshot: `data:image/png;base64,${shot.toString("base64")}` };
      });
      return json(res, 200, data);
    }

    if (req.url === "/screenshot" && req.method === "POST") {
      const { url, fullPage = false } = await readJson(req);
      const shot = await withPage(url, (page) => page.screenshot({ fullPage, type: "png" }));
      return json(res, 200, { screenshot: `data:image/png;base64,${shot.toString("base64")}` });
    }

    if (req.url === "/click" && req.method === "POST") {
      const { url, selector } = await readJson(req);
      const data = await withPage(url, async (page) => {
        await page.click(selector, { timeout: 5000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        return { url: page.url(), text: (await page.innerText("body")).slice(0, 2000) };
      });
      return json(res, 200, data);
    }

    if (req.url === "/fill" && req.method === "POST") {
      const { url, selector, value } = await readJson(req);
      const data = await withPage(url, async (page) => {
        await page.fill(selector, value, { timeout: 5000 });
        return { ok: true };
      });
      return json(res, 200, data);
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => {
  console.log(`🎭 Playwright bridge on http://localhost:${PORT}`);
});
