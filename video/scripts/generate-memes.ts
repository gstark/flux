/**
 * Generate meme images via OpenAI's gpt-image-1 model.
 * Usage: bun video/scripts/generate-memes.ts
 *
 * Requires OPENAI_API_KEY in .env.local
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "..", "public", "memes");

// gpt-image-1 — change if using a different model
const MODEL = "gpt-image-1";

interface MemeSpec {
  filename: string;
  prompt: string;
}

const MEMES: MemeSpec[] = [
  {
    filename: "meme-handoff.png",
    prompt:
      "A split cartoon illustration. Left side: a stressed office worker drowning in a mountain of sticky notes and Jira tickets, looking exhausted. Right side: a calm, smug robot pressing a single glowing blue button labeled 'CREATE'. Minimalist flat illustration style, clean white background, tech humor aesthetic. No text except the button label.",
  },
  {
    filename: "meme-tests-pass.png",
    prompt:
      "A cartoon robot sitting at a desk proudly giving a thumbs up at a terminal screen showing 'ALL TESTS PASS ✓' in green text. Behind the robot, a small fire burns unnoticed on a server rack. The robot is completely oblivious and looks very pleased with itself. Flat illustration style, meme humor, dark background.",
  },
  {
    filename: "meme-self-review.png",
    prompt:
      "Two identical cartoon robots in an office pointing at each other accusingly. One holds a paper labeled 'BUG REPORT' and the other holds a paper labeled 'MY CODE'. Both look confused and slightly offended. Simple flat illustration style, comedic tone, like the Spider-Man pointing meme but with robots.",
  },
  {
    filename: "meme-code-review.png",
    prompt:
      "A cartoon robot wearing oversized reading glasses, sitting at a desk completely surrounded by floating red comment bubbles. The bubbles say things like 'nit:', 'Actually...', 'Have you considered...', 'LGTM jk'. The robot looks increasingly concerned and overwhelmed. Flat illustration style, tech humor.",
  },
];

async function loadApiKey(): Promise<string> {
  const envPath = join(import.meta.dir, "..", "..", ".env.local");
  const content = await readFile(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("OPENAI_API_KEY=")) {
      return trimmed
        .slice("OPENAI_API_KEY=".length)
        .replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("OPENAI_API_KEY not found in .env.local");
}

async function generateMeme(apiKey: string, spec: MemeSpec): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: spec.prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    data: Array<{ url?: string; b64_json?: string }>;
  };
  const image = data.data[0];

  if (image?.b64_json) {
    const buffer = Buffer.from(image.b64_json, "base64");
    await Bun.write(join(OUTPUT_DIR, spec.filename), buffer);
  } else if (image?.url) {
    const imgResponse = await fetch(image.url);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download image: ${imgResponse.status}`);
    }
    const buffer = await imgResponse.arrayBuffer();
    await Bun.write(join(OUTPUT_DIR, spec.filename), buffer);
  } else {
    throw new Error("No image data in response");
  }

  console.log(`  ✓ ${spec.filename}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const apiKey = await loadApiKey();
  console.log(`Generating meme images with ${MODEL}...\n`);

  for (const spec of MEMES) {
    console.log(`Generating: ${spec.filename}`);
    await generateMeme(apiKey, spec);
  }

  console.log(`\nDone. ${MEMES.length} meme images saved to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Meme generation failed:", err);
  process.exit(1);
});
