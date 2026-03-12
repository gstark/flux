import type React from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

interface MemeCardProps {
  src: string;
  caption: string;
}

export const MemeCard: React.FC<MemeCardProps> = ({ src, caption }) => {
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
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        opacity,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          maxWidth: 700,
          maxHeight: 700,
          borderRadius: 16,
          border: `2px solid ${COLORS.accent}44`,
        }}
      />
      <div
        style={{
          color: COLORS.muted,
          fontSize: 24,
          fontWeight: 500,
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          textAlign: "center",
          maxWidth: 800,
        }}
      >
        {caption}
      </div>
    </div>
  );
};
