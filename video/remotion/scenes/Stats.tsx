import type React from "react";
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { StatCounter } from "../components/StatCounter";
import { fadeIn, fadeOut } from "../lib/animations";
import { COLORS } from "../lib/constants";

export const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity = fadeIn(frame, fps) * fadeOut(frame, fps, durationInFrames);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 120,
          alignItems: "flex-start",
        }}
      >
        <StatCounter value={813} label="Issues" delay={0} />
        <StatCounter value={1852} label="Sessions" delay={8} />
        <StatCounter value={5} label="Projects" delay={16} />
        <StatCounter value={0} label="Manual Intervention" delay={24} />
      </div>
      <Audio src={staticFile("audio/vo-stats.mp3")} />
    </div>
  );
};
