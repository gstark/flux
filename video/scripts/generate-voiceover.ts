/**
 * Generate voiceover audio via ElevenLabs TTS API.
 * Usage: bun video/scripts/generate-voiceover.ts
 *
 * Requires ELEVENLABS_API_KEY in .env.local
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "..", "public", "audio");

// ElevenLabs voice ID — "Adam" (deep, professional male voice)
// Change this to your preferred voice ID from ElevenLabs
const VOICE_ID = "pNInz6obpgDQGcFmaJgB";

interface VOSegment {
  filename: string;
  text: string;
}

const SEGMENTS: VOSegment[] = [
  {
    filename: "vo-cold-open.mp3",
    text: "You write the PRD. Flux builds it.",
  },
  {
    filename: "vo-handoff.mp3",
    text: "Claude reads the spec and files issues. Priorities, dependencies, descriptions. You don't write tickets. You write intent.",
  },
  {
    filename: "vo-work.mp3",
    text: "Flux picks up the first issue, spawns an agent, and it builds. Not just writes — validates. Every change is tested against the running server before it's committed.",
  },
  {
    filename: "vo-retro.mp3",
    text: "Then it reflects. What friction did it hit? What's missing? It files its own follow-up issues. The backlog grows from the work itself.",
  },
  {
    filename: "vo-review.mp3",
    text: "A review agent reads the diff. Fixes what it can, files what it can't. No human in the loop.",
  },
  {
    filename: "vo-highlights.mp3",
    text: "An agent caught a committed API key. Another fixed a stale skill. Review agents enforced no-silent-fallbacks on Flux itself.",
  },
  {
    filename: "vo-stats-close.mp3",
    text: "Eight hundred issues. Eighteen hundred sessions. Zero intervention. You write the what. Flux handles the rest.",
  },
];

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

async function generateSegment(
  apiKey: string,
  segment: VOSegment,
): Promise<void> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: segment.text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${body}`);
  }

  const buffer = await response.arrayBuffer();
  const outPath = join(OUTPUT_DIR, segment.filename);
  await Bun.write(outPath, buffer);
  console.log(
    `  ✓ ${segment.filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const apiKey = await loadApiKey();
  console.log("Generating voiceover segments...\n");

  for (const segment of SEGMENTS) {
    console.log(`Generating: ${segment.filename}`);
    await generateSegment(apiKey, segment);
  }

  console.log(`\nDone. ${SEGMENTS.length} audio files saved to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Voiceover generation failed:", err);
  process.exit(1);
});
