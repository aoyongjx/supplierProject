#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs/promises";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function maybeWriteJson(path, data) {
  if (!path) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  await fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`saved ${path}`);
}

const url = arg("url");
const output = arg("output");
const waitFor = arg("wait-for", "body");
const headless = !hasFlag("headed");
const storageState = arg("storage-state");
const userDataDir = arg("user-data-dir");
const screenshot = arg("screenshot");

if (!url) {
  console.error("usage: node playwright_extract_template.mjs --url=https://example.com [--wait-for=.selector] [--output=result.json]");
  process.exit(1);
}

const launchOptions = {
  channel: "msedge",
  headless,
};

const context = userDataDir
  ? await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    })
  : await chromium.launch({
      ...launchOptions,
    }).then((browser) =>
      browser.newContext({
        storageState: storageState || undefined,
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
      }),
    );

const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator(waitFor).waitFor({ timeout: 30000 });

  const title = await page.title();
  const bodyText = cleanText(await page.locator("body").innerText());

  const result = {
    url: page.url(),
    fetchedAt: new Date().toISOString(),
    title,
    fields: {
      bodyPreview: bodyText.slice(0, 1000),
    },
  };

  if (screenshot) {
    await page.screenshot({ path: screenshot, fullPage: true });
  }

  await maybeWriteJson(output, result);
} finally {
  await context.close();
}
