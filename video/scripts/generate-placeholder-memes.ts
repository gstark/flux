/**
 * Generate placeholder meme images for Remotion preview.
 * Usage: bun video/scripts/generate-placeholder-memes.ts
 *
 * Creates simple colored PNG placeholders so Remotion doesn't fail
 * when real meme images haven't been generated yet.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "..", "public", "memes");

const FILES = [
  "meme-handoff.png",
  "meme-tests-pass.png",
  "meme-self-review.png",
  "meme-code-review.png",
];

// Minimal valid 1x1 PNG (dark blue pixel) — enough for Remotion to load
// Browsers will stretch it to fill the container
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const file of FILES) {
    await Bun.write(join(OUTPUT_DIR, file), PLACEHOLDER_PNG);
    console.log(`  ✓ ${file} (placeholder)`);
  }

  console.log(`\nDone. ${FILES.length} placeholder meme images created.`);
  console.log(
    "Run 'bun video/scripts/generate-memes.ts' to generate real images.",
  );
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
