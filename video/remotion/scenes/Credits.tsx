import type React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

const CREDITS = [
  "No humans were mass-employed in the production of this video.",
  "The voiceover is synthetic. It sounds better than we do.",
  "The meme images were hallucinated by a diffusion model.",
  "The screenshots are real — we're not monsters.",
  "The code was written by agents who then reviewed their own code.",
  "They found bugs. They filed issues. Against themselves.",
  "We are not sure if this is inspiring or terrifying.",
];

export const Credits: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Scroll speed — move credits upward over the full duration
  const totalTextHeight = CREDITS.length * 60 + 200;
  const scrollY = interpolate(
    frame,
    [0, durationInFrames],
    [100, -totalTextHeight],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  // Fade in at start, fade out at end
  const opacity = interpolate(
    frame,
    [0, 15, durationInFrames - 15, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflow: "hidden",
        opacity,
      }}
    >
      <div
        style={{
          transform: `translateY(${scrollY}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          paddingTop: 400,
        }}
      >
        {CREDITS.map((line) => (
          <div
            key={line}
            style={{
              color: COLORS.muted,
              fontSize: 24,
              fontWeight: 400,
              fontFamily: FONT_DISPLAY,
              textAlign: "center",
              maxWidth: 800,
              lineHeight: 1.5,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
