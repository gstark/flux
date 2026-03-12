import type React from "react";
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut, slideUp } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity = fadeIn(frame, fps) * fadeOut(frame, fps, durationInFrames);
  const y = slideUp(frame, fps, 0);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 32,
        opacity,
      }}
    >
      {/* Flux logo text */}
      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          fontFamily: FONT_DISPLAY,
          color: COLORS.text,
          letterSpacing: -2,
          transform: `translateY(${y}px)`,
        }}
      >
        Flux
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 36,
          fontWeight: 400,
          fontFamily: FONT_DISPLAY,
          color: COLORS.muted,
          transform: `translateY(${y}px)`,
        }}
      >
        You write the what. It handles everything else.
      </div>

      <Audio src={staticFile("audio/vo-close.mp3")} />
    </div>
  );
};
