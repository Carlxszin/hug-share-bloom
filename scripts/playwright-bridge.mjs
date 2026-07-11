// Optional Playwright bridge for Octopus — PERSISTENT session.
// Run: npx playwright install chromium && node scripts/playwright-bridge.mjs
//
// Mantém UMA janela do Chromium aberta o tempo todo. Cada requisição reusa
// a mesma aba (ou cria abas nomeadas via `tab`). Assim o login, cookies e
// estado ficam salvos entre chamadas — nada de abrir janela nova toda hora.
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { chromium } from "playwright";

const PORT = 7676;
const USER_DATA_DIR = path.join(os.homedir(), "octopus-data", "browser-profile");
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

let context;
const pages = new Map(); // tabName -> Page

async function getContext() {
  if (context) return context;
  // launchPersistentContext = mesmo perfil (cookies, login, histórico) sempre.
  // headless:false pro chefe VER o navegador e poder interagir junto.
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--start-maximized"],
  });
  context.on("close", () => {
    context = undefined;
    pages.clear();
  });
  return context;
}

async function getPage(tab = "main") {
  const ctx = await getContext();
  let page = pages.get(tab);
  if (!page || page.isClosed()) {
    // Reusa a primeira aba existente se for "main" e ainda não tivermos registrado.
    const existing = ctx.pages();
    page = tab === "main" && existing.length ? existing[0] : await ctx.newPage();
    pages.set(tab, page);
  }
  return page;
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

async function snapshot(page) {
  const title = await page.title().catch(() => "");
  const text = await page.innerText("body").catch(() => "");
  const shot = await page.screenshot({ fullPage: false, type: "png" });
  return {
    url: page.url(),
    title,
    text: text.slice(0, 4000),
    screenshot: `data:image/png;base64,${shot.toString("base64")}`,
  };
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
    if (req.url === "/health") return json(res, 200, { ok: true, persistent: true });

    if (req.url === "/tabs" && req.method === "GET") {
      const ctx = await getContext();
      return json(
        res,
        200,
        { tabs: ctx.pages().map((p, i) => ({ index: i, url: p.url(), title: undefined })) },
      );
    }

    const body = req.method === "POST" ? await readJson(req) : {};
    const tab = body.tab ?? "main";

    if (req.url === "/navigate" && req.method === "POST") {
      const page = await getPage(tab);
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/snapshot" && req.method === "POST") {
      const page = await getPage(tab);
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/screenshot" && req.method === "POST") {
      const page = await getPage(tab);
      const shot = await page.screenshot({ fullPage: !!body.fullPage, type: "png" });
      return json(res, 200, { screenshot: `data:image/png;base64,${shot.toString("base64")}` });
    }

    if (req.url === "/click" && req.method === "POST") {
      const page = await getPage(tab);
      await page.click(body.selector, { timeout: 8000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/fill" && req.method === "POST") {
      const page = await getPage(tab);
      await page.fill(body.selector, body.value, { timeout: 8000 });
      if (body.submit) await page.keyboard.press("Enter");
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/eval" && req.method === "POST") {
      const page = await getPage(tab);
      const result = await page.evaluate(body.script);
      return json(res, 200, { result });
    }

    if (req.url === "/close-tab" && req.method === "POST") {
      const page = pages.get(tab);
      if (page && !page.isClosed()) await page.close();
      pages.delete(tab);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => {
  console.log(`🎭 Playwright bridge PERSISTENTE em http://localhost:${PORT}`);
  console.log(`   Perfil salvo em: ${USER_DATA_DIR}`);
});
