import type React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { FadeTransition } from "../components/FadeTransition";
import { Screenshot } from "../components/Screenshot";
import { TextOverlay } from "../components/TextOverlay";

interface Highlight {
  screenshot: string;
  title: string;
  subtitle: string;
  panX?: number;
  panY?: number;
  scaleEnd?: number;
}

const HIGHLIGHTS: Highlight[] = [
  {
    screenshot: "screenshots/highlight-api-key.png",
    title: "Committed API key caught",
    subtitle:
      'Agent found ZAI_API_KEY in git history — filed "please rotate this, I can\'t."',
    scaleEnd: 1.04,
    panY: -10,
  },
  {
    screenshot: "screenshots/highlight-stale-skill.png",
    title: "Stale skill updated",
    subtitle:
      "Teaching 2.x syntax to a 3.0 runtime. Agents fixed their own training data.",
    scaleEnd: 1.03,
    panX: 8,
  },
  {
    screenshot: "screenshots/highlight-schedule-next.png",
    title: "Silent failure catch",
    subtitle:
      '"scheduleNext swallows all errors" — agents reading CLAUDE.md better than we do.',
    scaleEnd: 1.05,
  },
];

export const Highlights: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const perHighlight = Math.floor(durationInFrames / HIGHLIGHTS.length);

  return (
    <FadeTransition>
      {HIGHLIGHTS.map((h, i) => (
        <Sequence
          key={h.title}
          from={i * perHighlight}
          durationInFrames={perHighlight}
        >
          <Screenshot
            src={h.screenshot}
            scaleStart={1.0}
            scaleEnd={h.scaleEnd ?? 1.04}
            panX={h.panX}
            panY={h.panY}
          />
          <TextOverlay
            text={h.title}
            subtitle={h.subtitle}
            position="bottom-left"
            fontSize={44}
            delay={5}
          />
        </Sequence>
      ))}
      <Audio src={staticFile("audio/vo-highlights.mp3")} />
    </FadeTransition>
  );
};
