import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut } from "../lib/animations";
import { FONT_MONO } from "../lib/fonts";

interface CodeBlockProps {
  code: string;
  language?: string;
  delay?: number;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity =
    fadeIn(frame, fps, delay) * fadeOut(frame, fps, durationInFrames);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 120,
        left: "50%",
        transform: "translateX(-50%)",
        opacity,
        zIndex: 10,
      }}
    >
      <pre
        style={{
          background: "rgba(0, 0, 0, 0.9)",
          color: "#e2e8f0",
          fontSize: 24,
          fontFamily: FONT_MONO,
          padding: "24px 32px",
          borderRadius: 12,
          border: "1px solid #334155",
          maxWidth: 1400,
          overflow: "hidden",
          margin: 0,
        }}
      >
        {code}
      </pre>
    </div>
  );
};
