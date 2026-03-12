#!/usr/bin/env bash
set -euo pipefail

# Full pipeline: capture screenshots → generate memes → generate TTS → generate music → render video
# Usage: ./video/scripts/render.sh [--skip-capture] [--skip-memes] [--skip-tts] [--skip-music]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VIDEO_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$VIDEO_DIR")"

SKIP_CAPTURE=false
SKIP_MEMES=false
SKIP_TTS=false
SKIP_MUSIC=false

for arg in "$@"; do
  case $arg in
    --skip-capture) SKIP_CAPTURE=true ;;
    --skip-memes) SKIP_MEMES=true ;;
    --skip-tts) SKIP_TTS=true ;;
    --skip-music) SKIP_MUSIC=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo "=== Flux Demo Video Pipeline ==="
echo ""

# Step 1: Capture screenshots
if [ "$SKIP_CAPTURE" = false ]; then
  echo "📸 Step 1: Capturing screenshots..."
  bun "$SCRIPT_DIR/capture-screenshots.ts"
  echo ""
else
  echo "⏭️  Step 1: Skipping screenshot capture"
fi

# Step 2: Generate memes
if [ "$SKIP_MEMES" = false ]; then
  echo "🎨 Step 2: Generating meme images..."
  bun "$SCRIPT_DIR/generate-memes.ts"
  echo ""
else
  echo "⏭️  Step 2: Skipping meme generation"
fi

# Step 3: Generate voiceover
if [ "$SKIP_TTS" = false ]; then
  echo "🎙️  Step 3: Generating voiceover..."
  bun "$SCRIPT_DIR/generate-voiceover.ts"
  echo ""
else
  echo "⏭️  Step 3: Skipping TTS generation"
fi

# Step 4: Generate background music
if [ "$SKIP_MUSIC" = false ]; then
  echo "🎵 Step 4: Generating background music..."
  bun "$SCRIPT_DIR/generate-music.ts"
  echo ""
else
  echo "⏭️  Step 4: Skipping music generation"
fi

# Step 5: Render video
echo "🎬 Step 5: Rendering video..."
mkdir -p "$VIDEO_DIR/out"
npx remotion render \
  "$VIDEO_DIR/remotion/index.ts" \
  FluxDemo \
  "$VIDEO_DIR/out/flux-demo.mp4" \
  --public-dir "$VIDEO_DIR/public" \
  --props '{}' \
  --log=verbose

echo ""
echo "✅ Done! Output: $VIDEO_DIR/out/flux-demo.mp4"
