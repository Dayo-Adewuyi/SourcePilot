import { chromium, type Browser } from "playwright";
import { config } from "../config";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  browser = await chromium.launch({
    headless: config.playwright.headless,
    proxy: config.playwright.proxy ? { server: config.playwright.proxy } : undefined,
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  await browser.close();
  browser = null;
}
