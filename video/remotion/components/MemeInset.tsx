import type React from "react";
import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

interface MemeInsetProps {
  src: string;
}

export const MemeInset: React.FC<MemeInsetProps> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Spring in from bottom-right
  const enter = spring({ frame, fps, config: { damping: 15, mass: 0.8 } });

  // Fade out at the end
  const exit = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const translateY = interpolate(enter, [0, 1], [80, 0]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        right: 60,
        opacity: enter * exit,
        transform: `translateY(${translateY}px)`,
        zIndex: 20,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: 320,
          height: 320,
          objectFit: "cover",
          borderRadius: 16,
          border: "3px solid rgba(255,255,255,0.15)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      />
    </div>
  );
};
