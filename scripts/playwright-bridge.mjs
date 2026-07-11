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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function collectElements(page) {
  return page.evaluate(() => {
    const pickText = (el) =>
      (el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el.innerText ||
        el.textContent ||
        "")
        .replace(/\s+/g, " ")
        .trim();

    return Array.from(
      document.querySelectorAll(
        'a, button, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [contenteditable="true"]',
      ),
    )
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const text = pickText(el);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || tag;
        const id = el.id ? `#${CSS.escape(el.id)}` : "";
        const name = el.getAttribute("name");
        const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
        const selector =
          id ||
          (testId ? `[data-testid="${CSS.escape(testId)}"]` : "") ||
          (name ? `${tag}[name="${CSS.escape(name)}"]` : "") ||
          `${tag}:nth-of-type(${index + 1})`;
        return {
          index,
          role,
          text: text.slice(0, 120),
          selector,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= window.innerHeight &&
            rect.left <= window.innerWidth,
        };
      })
      .filter((x) => x.text || x.role === "input" || x.role === "textarea")
      .slice(0, 80);
  });
}

async function snapshot(page) {
  const title = await page.title().catch(() => "");
  const text = await page.innerText("body").catch(() => "");
  const elements = await collectElements(page).catch(() => []);
  const shot = await page.screenshot({ fullPage: false, type: "png" });
  return {
    url: page.url(),
    title,
    text: text.slice(0, 5000),
    elements,
    screenshot: `data:image/png;base64,${shot.toString("base64")}`,
  };
}

async function findLocator(page, body) {
  if (body.selector) return page.locator(body.selector).first();

  const text = String(body.text || body.label || body.name || "").trim();
  if (!text) throw new Error("Envie selector ou text/label para clicar/preencher.");

  const exact = body.exact !== false;
  const candidates = [
    page.getByRole("button", { name: text, exact }),
    page.getByRole("link", { name: text, exact }),
    page.getByRole("menuitem", { name: text, exact }),
    page.getByLabel(text, { exact }),
    page.getByPlaceholder(text, { exact }),
    page.getByTitle(text, { exact }),
    page.getByText(text, { exact }),
  ];

  for (const locator of candidates) {
    try {
      if ((await locator.count()) > 0) return locator.first();
    } catch {
      /* try next */
    }
  }

  const fuzzy = page.locator(`text=${text}`).first();
  if ((await fuzzy.count().catch(() => 0)) > 0) return fuzzy;
  throw new Error(`Elemento não encontrado: ${text}`);
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
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/read" && req.method === "POST") {
      const page = await getPage(tab);
      if (body.url) {
        await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      }
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
      const locator = await findLocator(page, body);
      await locator.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await locator.click({ timeout: 8000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/scroll" && req.method === "POST") {
      const page = await getPage(tab);
      const amount = Number(body.amount ?? 700);
      const direction = String(body.direction ?? "down").toLowerCase();
      if (body.selector || body.text || body.label || body.name) {
        const locator = await findLocator(page, body);
        await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
      } else {
        const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
        await page.mouse.wheel(0, delta);
      }
      await sleep(350);
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/fill" && req.method === "POST") {
      const page = await getPage(tab);
      const locator = await findLocator(page, body);
      await locator.fill(String(body.value ?? ""), { timeout: 8000 });
      if (body.submit) await page.keyboard.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return json(res, 200, await snapshot(page));
    }

    if (req.url === "/press" && req.method === "POST") {
      const page = await getPage(tab);
      await page.keyboard.press(String(body.key ?? "Enter"));
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
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
