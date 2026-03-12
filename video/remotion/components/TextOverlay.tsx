import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut, slideUp } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

interface TextOverlayProps {
  text: string;
  subtitle?: string;
  position?: "center" | "bottom" | "top" | "bottom-left";
  delay?: number;
  fontSize?: number;
}

export const TextOverlay: React.FC<TextOverlayProps> = ({
  text,
  subtitle,
  position = "bottom",
  delay = 0,
  fontSize = 48,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity =
    fadeIn(frame, fps, delay) * fadeOut(frame, fps, durationInFrames);
  const y = slideUp(frame, fps, delay);

  const positionStyles: React.CSSProperties =
    position === "center"
      ? {
          top: "50%",
          left: "50%",
          transform: `translate(-50%, calc(-50% + ${y}px))`,
        }
      : position === "top"
        ? { top: 80, left: 100, transform: `translateY(${y}px)` }
        : position === "bottom-left"
          ? { bottom: 100, left: 100, transform: `translateY(${y}px)` }
          : {
              bottom: 100,
              left: "50%",
              transform: `translateX(-50%) translateY(${y}px)`,
            };

  return (
    <div
      style={{
        position: "absolute",
        ...positionStyles,
        opacity,
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          padding: "24px 48px",
          borderRadius: 16,
          border: `1px solid ${COLORS.accent}33`,
        }}
      >
        <div
          style={{
            color: COLORS.text,
            fontSize,
            fontWeight: 600,
            fontFamily: FONT_DISPLAY,
            lineHeight: 1.3,
            maxWidth: 1200,
          }}
        >
          {text}
        </div>
        {subtitle && (
          <div
            style={{
              color: COLORS.muted,
              fontSize: fontSize * 0.6,
              fontWeight: 400,
              fontFamily: FONT_DISPLAY,
              marginTop: 8,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
