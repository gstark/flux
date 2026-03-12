/**
 * Generate silent MP3 placeholder files for Remotion preview.
 * Usage: bun video/scripts/generate-silence.ts
 *
 * Uses ffmpeg to create proper MP3 files that ffprobe can parse.
 * Remotion's renderer calls ffprobe on every audio asset — hand-rolled
 * MP3 frames fail with "Failed to find two consecutive MPEG audio frames".
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "..", "public", "audio");

// duration in seconds per file — bg-music needs to span the full video
const FILES: Record<string, number> = {
  "vo-cold-open.mp3": 3,
  "vo-handoff.mp3": 10,
  "vo-work.mp3": 11,
  "vo-retro.mp3": 11,
  "vo-review.mp3": 7,
  "vo-highlights.mp3": 10,
  "vo-stats-close.mp3": 6,
  "bg-music.mp3": 120,
};

async function generateSilentMp3(outPath: string, durationSec: number) {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=44100:cl=stereo`,
      "-t",
      String(durationSec),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderr}`);
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const [file, duration] of Object.entries(FILES)) {
    const outPath = join(OUTPUT_DIR, file);
    if (existsSync(outPath)) {
      console.log(`  ⏭ ${file} (already exists, skipping)`);
      continue;
    }
    await generateSilentMp3(outPath, duration);
    console.log(`  ✓ ${file} (${duration}s silence)`);
  }

  console.log(`\nDone. Placeholder audio files created (skipped existing).`);
  console.log(
    "Run 'bun video/scripts/generate-voiceover.ts' to generate real TTS.",
  );
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
