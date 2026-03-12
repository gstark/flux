import type React from "react";
import {
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { StatCounter } from "../components/StatCounter";
import { fadeIn, fadeOut, slideUp } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

export const StatsClose: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Stats phase: first 60% of scene
  const statsEnd = Math.floor(durationInFrames * 0.6);

  // Close phase opacity (fades in during second half)
  const closeDelay = statsEnd - 10; // slight overlap
  const closeOpacity =
    fadeIn(frame, fps, closeDelay) * fadeOut(frame, fps, durationInFrames);

  const statsOpacity =
    fadeIn(frame, fps) * fadeOut(frame, fps, durationInFrames, statsEnd * 0.3);

  const y = slideUp(frame, fps, closeDelay);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        position: "relative",
      }}
    >
      {/* Stats counters — first phase */}
      <Sequence durationInFrames={statsEnd}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            opacity: statsOpacity,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 100,
              alignItems: "flex-start",
            }}
          >
            <StatCounter value={813} label="Issues" delay={0} />
            <StatCounter value={1852} label="Sessions" delay={6} />
            <StatCounter value={5} label="Projects" delay={12} />
            <StatCounter value={0} label="Manual Intervention" delay={18} />
          </div>
        </div>
      </Sequence>

      {/* Close — Flux logo + tagline */}
      <Sequence from={statsEnd} durationInFrames={durationInFrames - statsEnd}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 32,
            opacity: closeOpacity,
          }}
        >
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
        </div>
      </Sequence>

      <Audio src={staticFile("audio/vo-stats-close.mp3")} />
    </div>
  );
};
