import type React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY } from "../lib/fonts";

/**
 * Just the "serious disclaimer" + glitch. The "just kidding" overlay
 * is rendered in Video.tsx so it can span across into the ColdOpen scene.
 */
export const Disclaimer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Phase 1 (0-1.5s): Serious disclaimer fades in
  // Phase 2 (1.5-2.5s): Text glitches and fades out
  const phase1End = Math.floor(fps * 1.5);
  const phase2End = Math.floor(fps * 2.5);

  const seriousOpacity =
    frame < phase1End
      ? fadeIn(frame, fps)
      : frame < phase2End
        ? interpolate(frame, [phase1End, phase2End], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;

  const isGlitching = frame >= phase1End && frame < phase2End;
  const glitchX = isGlitching ? Math.sin(frame * 3) * 8 : 0;
  const glitchSkew = isGlitching ? Math.sin(frame * 5) * 2 : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          opacity: seriousOpacity,
          transform: `translateX(${glitchX}px) skewX(${glitchSkew}deg)`,
        }}
      >
        <div
          style={{
            color: COLORS.text,
            fontSize: 42,
            fontWeight: 500,
            fontFamily: FONT_DISPLAY,
            textAlign: "center",
            letterSpacing: 1,
          }}
        >
          No artificial intelligence was used
        </div>
        <div
          style={{
            color: COLORS.text,
            fontSize: 42,
            fontWeight: 500,
            fontFamily: FONT_DISPLAY,
            textAlign: "center",
            letterSpacing: 1,
            marginTop: 8,
          }}
        >
          in the making of this video.
        </div>
      </div>
    </div>
  );
};
