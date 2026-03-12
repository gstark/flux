import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { countUp, fadeIn } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

interface StatCounterProps {
  value: number;
  label: string;
  delay?: number;
  prefix?: string;
}

export const StatCounter: React.FC<StatCounterProps> = ({
  value,
  label,
  delay = 0,
  prefix = "",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = fadeIn(frame, fps, delay);
  const current = countUp(frame, fps, value, delay);

  return (
    <div
      style={{
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          color: COLORS.highlight,
          fontSize: 96,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {prefix}
        {current.toLocaleString()}
      </div>
      <div
        style={{
          color: COLORS.muted,
          fontSize: 28,
          fontWeight: 500,
          fontFamily: FONT_DISPLAY,
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
};
