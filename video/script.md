# Flux Demo Video — "From PRD to Production, Autonomously"

~75 seconds. Screenshot-based Remotion video with ElevenLabs TTS, AI-generated memes, and irreverent self-aware humor.

---

## DISCLAIMER (0:00–0:05)

**[Black background. Clean white text fades in:]**

"No artificial intelligence was used in the making of this video."

**[Text glitches and distorts for 1 second, then dissolves. New text fades in:]**

"Just kidding. This entire video — script, voiceover, memes, editing — was made by AI. The screenshots are real though."

---

## COLD OPEN (0:05–0:09)

**[Screenshot: Flux projects dashboard. Very subtle zoom (1.0→1.04) — the text is the focus.]**

**Text overlay:** "You write the PRD."

**VO:** "You write the PRD. Flux builds it."

---

## THE HANDOFF (0:09–0:17)

**[Screenshot 1: Dashboard with code block overlay — subtle pan left, no zoom. Terminal shows `issues_bulk_create` call.]**

**[Screenshot 2: Issues list — nearly static. Text overlay: "Tickets? In this economy?"]**

**VO:** "Claude Code reads the spec, breaks it into issues via Flux's MCP server. Priorities, descriptions, dependencies. You don't write tickets. You write intent."

---

## MEME BREAK 1 (0:17–0:19.5)

**[AI-generated meme: Stressed worker drowning in Jira tickets vs. calm robot pressing one button]**

*"Writing Jira tickets manually vs. one MCP call"*

---

## THE WORK LOOP (0:19.5–0:29.5)

**[Screenshot 1: Agent transcript — slow pan down, slight zoom (1.0→1.06)]**

**Text overlay:** "Agent builds, validates, commits."
**Snarky subtitle:** "Yes, it runs curl to check its own work. We're all terrified too."

**[Screenshot 2: Session detail — nearly static]**

**VO:** "Flux picks up the first issue, spawns an agent, and it builds. Not just writes — validates. Every change is tested against the running server before it's committed."

---

## MEME BREAK 2 (0:29.5–0:32)

**[AI-generated meme: Proud robot at desk, "ALL TESTS PASS", fire burning behind it]**

*"The tests pass. Ship it. What could go wrong?"*

---

## THE RETRO (0:32–0:40)

**[Screenshot: Session transcript. Very subtle zoom only (1.0→1.04).]**

**Text overlay:** `"No input validation on request bodies."`
**Snarky subtitle:** "Imagine if your coworkers filed bugs against their own PRs."

**VO:** "Then it reflects. What friction did it hit? What's missing? It files its own follow-up issues. The backlog grows from the work itself."

---

## MEME BREAK 3 (0:40–0:42.5)

**[AI-generated meme: Two identical robots pointing at each other — one holding "BUG REPORT", other holding "MY CODE"]**

*"Agent filing bugs against Agent's own code"*

---

## THE REVIEW (0:42.5–0:50.5)

**[Screenshot: Issue detail page. Subtle pan right (10px), minimal zoom (1.0→1.04).]**

**Text overlay:** "A fresh review agent reads the diff."
**Snarky subtitle:** "Ruthlessly. Without any of the social pressure to just approve."

**VO:** "A fresh review agent reads the diff. Fixes what it can, files what it can't. When it passes clean — the next issue starts. No human in the loop."

---

## MEME BREAK 4 (0:50.5–0:53)

**[AI-generated meme: Robot with reading glasses surrounded by floating "nit:", "Actually...", "LGTM jk" comment bubbles]**

*"Review agent on its third pass"*

---

## HIGHLIGHTS (0:53–1:07)

Quick cuts — 5 screenshots, ~2.8 seconds each, varied Ken Burns (some zoom, some pan, never both):

1. **Committed API key caught** — `Agent found ZAI_API_KEY in git history — filed "please rotate this, I can't."`
2. **Stale skill updated** — "Teaching 2.x syntax to a 3.0 runtime. Agents fixed their own training data."
3. **Silent failure catch** — `"scheduleNext swallows all errors" — agents reading CLAUDE.md better than we do.`
4. **Security vulnerability** — "Slug injection in a web scraper. Caught by a robot with no bug bounty incentive."
5. **Self-improving reviews** — "Three rounds of self-review. More thorough than most humans. We said it."

**VO:** "An agent found a committed API key and escalated for human rotation. Another caught a stale skill wasting forty percent of agent time. Review agents enforced no-silent-fallbacks on Flux itself. Security vulnerabilities, caught in code review. Self-improving, iteration after iteration."

---

## STATS (1:07–1:12)

**[Dark background. Four animated counters counting up simultaneously:]**

- **813** Issues
- **1,852** Sessions
- **5** Projects
- **0** Manual Intervention

**VO:** "Eight hundred thirteen issues. Eighteen hundred fifty-two sessions. Five projects. Zero manual intervention."

---

## CLOSE (1:12–1:15)

**[Dark background. Large "Flux" text with spring entrance. Tagline below.]**

**Text:** Flux
**Subtitle:** You write the what. It handles everything else.

**VO:** "Flux. You write the what. It handles everything else."

---

## CREDITS (1:15–1:20)

**[Black background. Small text scrolls up, movie-credits style:]**

- No humans were mass-employed in the production of this video.
- The voiceover is synthetic. It sounds better than we do.
- The meme images were hallucinated by a diffusion model.
- The screenshots are real — we're not monsters.
- The code was written by agents who then reviewed their own code.
- They found bugs. They filed issues. Against themselves.
- We are not sure if this is inspiring or terrifying.

---

## Production Pipeline

### Screenshots
24 real Flux UI screenshots in `video/public/screenshots/`. Additional captures via `bun video/scripts/capture-screenshots.ts`.

### Memes
AI-generated via `bun video/scripts/generate-memes.ts`. Requires `OPENAI_API_KEY` in `.env.local`. Uses gpt-image-1 model. 4 meme images, 1024x1024.

### Voiceover
ElevenLabs TTS via `bun video/scripts/generate-voiceover.ts`. Requires `ELEVENLABS_API_KEY` in `.env.local`.

### Rendering
```bash
# Generate placeholders for preview
bun video/scripts/generate-silence.ts
bun video/scripts/generate-placeholder-memes.ts

# Generate real assets
bun video/scripts/generate-memes.ts      # AI meme images
bun video/scripts/generate-voiceover.ts  # TTS audio

# Preview
npx remotion studio video/remotion/index.ts --public-dir video/public

# Render
npx remotion render video/remotion/index.ts FluxDemo video/out/flux-demo.mp4 --public-dir video/public

# Full pipeline
./video/scripts/render.sh
./video/scripts/render.sh --skip-capture  # Skip screenshot capture
./video/scripts/render.sh --skip-memes    # Skip meme generation
./video/scripts/render.sh --skip-tts      # Skip TTS generation
```

### Technical Details
- **1920x1080 @ 30fps**, ~75 seconds total (~2250 frames)
- **Ken Burns** varied per scene: some subtle zoom only, some pan only, some static
- **4 meme breaks** between main scenes for comedic pacing
- **Disclaimer** opens with fake "no AI used" that glitches to reveal the truth
- **Credits** close with scrolling snarky small print
