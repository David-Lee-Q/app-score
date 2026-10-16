import puppeteer from "puppeteer-core";

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--hide-scrollbars",
          "--mute-audio",
        ],
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function renderPage(url, { timeout = 25000 } = {}) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const result = await page.evaluate(() => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const meta =
        document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      const title = document.title || "";
      const ogTitle =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
      const h1 = clean(document.querySelector("h1")?.innerText || "");
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      return { title, meta, ogTitle, h1, text };
    });

    const text = [
      result.title && `标题：${result.title}`,
      result.meta && `描述：${result.meta}`,
      result.text,
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      ok: !!text,
      text: text.slice(0, 8000),
      title: result.title,
      ogTitle: result.ogTitle,
      h1: result.h1,
      note: text ? "" : "渲染后无可提取文本",
    };
  } catch (err) {
    return { ok: false, text: "", note: `渲染失败：${err.message}` };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function extractMediaUrl(url, { timeout = 25000 } = {}) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    return await page.evaluate(() => {
      const metas = Array.from(
        document.querySelectorAll(
          'meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"],meta[itemprop="contentUrl"]',
        ),
      );
      for (const meta of metas) {
        const content = meta.getAttribute("content");
        if (content) return content;
      }
      const video = document.querySelector("video");
      if (video) {
        const src = video.currentSrc || video.src;
        if (src) return src;
        const source = video.querySelector("source");
        if (source && source.src) return source.src;
      }
      return "";
    });
  } catch {
    return "";
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // ignore
  }
  browserPromise = null;
}
