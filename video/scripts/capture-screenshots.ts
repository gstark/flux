/**
 * Capture Flux UI screenshots via Playwright.
 * Usage: bunx playwright test video/scripts/capture-screenshots.ts
 *
 * Or run manually:
 *   bun video/scripts/capture-screenshots.ts
 *
 * Requires Flux to be running at localhost:8042.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = `http://localhost:${process.env.FLUX_PORT ?? "8042"}`;
const OUTPUT_DIR = join(import.meta.dir, "..", "public", "screenshots");

interface ScreenshotSpec {
  name: string;
  path: string;
  waitFor?: string;
}

const SCREENSHOTS: ScreenshotSpec[] = [
  { name: "flux-home", path: "/" },
  { name: "flux-issues-list", path: "/issues" },
  { name: "flux-closed-issues", path: "/issues?status=closed" },
  { name: "flux-sessions-list", path: "/sessions" },
  { name: "flux-activity", path: "/activity" },
  { name: "flux-settings", path: "/settings" },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  for (const spec of SCREENSHOTS) {
    const url = `${BASE_URL}${spec.path}`;
    console.log(`Capturing ${spec.name} from ${url}...`);

    await page.goto(url, { waitUntil: "networkidle" });

    if (spec.waitFor) {
      await page.waitForSelector(spec.waitFor, { timeout: 5000 });
    }

    // Wait for animations to settle
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: join(OUTPUT_DIR, `${spec.name}.png`),
      fullPage: false,
    });

    console.log(`  ✓ ${spec.name}.png`);
  }

  await browser.close();
  console.log(
    `\nDone. ${SCREENSHOTS.length} screenshots saved to ${OUTPUT_DIR}`,
  );
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
