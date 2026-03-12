import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut } from "../lib/animations";

interface FadeTransitionProps {
  children: React.ReactNode;
  fadeInDuration?: number;
}

export const FadeTransition: React.FC<FadeTransitionProps> = ({
  children,
  fadeInDuration = 10,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity = fadeIn(frame, fps) * fadeOut(frame, fps, durationInFrames);

  return (
    <div style={{ width: "100%", height: "100%", opacity }}>{children}</div>
  );
};
