import type React from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { kenBurns } from "../lib/animations";

interface ScreenshotProps {
  src: string;
  panX?: number;
  panY?: number;
  scaleStart?: number;
  scaleEnd?: number;
}

export const Screenshot: React.FC<ScreenshotProps> = ({
  src,
  panX = 0,
  panY = 0,
  scaleStart = 1.0,
  scaleEnd = 1.15,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const { scale, translateX, translateY } = kenBurns(frame, durationInFrames, {
    scaleStart,
    scaleEnd,
    panX,
    panY,
  });

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        }}
      />
    </div>
  );
};
