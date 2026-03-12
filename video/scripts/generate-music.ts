/**
 * Generate background music via ElevenLabs Music API.
 * Usage: bun video/scripts/generate-music.ts
 *
 * Requires ELEVENLABS_API_KEY in .env.local
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "..", "public", "audio");
const OUTPUT_PATH = join(OUTPUT_DIR, "bg-music.mp3");

const PROMPT =
  "Lo-fi chill beats, relaxed warm instrumental, soft Rhodes piano, vinyl crackle, mellow drum loop, 80 BPM, background music for a tech product demo video, no vocals";

// 2 minutes in ms — we only need ~96s but generating longer lets us trim/loop
const MUSIC_LENGTH_MS = 120_000;

async function loadApiKey(): Promise<string> {
  const envPath = join(import.meta.dir, "..", "..", ".env.local");
  const content = await readFile(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ELEVENLABS_API_KEY=")) {
      return trimmed
        .slice("ELEVENLABS_API_KEY=".length)
        .replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("ELEVENLABS_API_KEY not found in .env.local");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const apiKey = await loadApiKey();
  console.log("Generating lo-fi background music via ElevenLabs...\n");

  const response = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      prompt: PROMPT,
      music_length_ms: MUSIC_LENGTH_MS,
      model_id: "music_v1",
      force_instrumental: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs Music API error (${response.status}): ${body}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(OUTPUT_PATH, buffer);
  console.log(
    `  ✓ bg-music.mp3 (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(`\nDone. Saved to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Music generation failed:", err);
  process.exit(1);
});
