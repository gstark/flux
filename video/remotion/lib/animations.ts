import { interpolate, type SpringConfig, spring } from "remotion";

const SMOOTH_SPRING: SpringConfig = {
  damping: 200,
  mass: 0.5,
  stiffness: 100,
};

export function fadeIn(frame: number, fps: number, delay = 0): number {
  return spring({ frame: frame - delay, fps, config: SMOOTH_SPRING });
}

export function fadeOut(
  frame: number,
  fps: number,
  durationInFrames: number,
  fadeFrames = 15,
): number {
  if (frame < durationInFrames - fadeFrames) return 1;
  return interpolate(
    frame,
    [durationInFrames - fadeFrames, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
}

export function slideUp(frame: number, fps: number, delay = 0): number {
  const progress = spring({ frame: frame - delay, fps, config: SMOOTH_SPRING });
  return interpolate(progress, [0, 1], [40, 0]);
}

export function kenBurns(
  frame: number,
  durationInFrames: number,
  opts: {
    scaleStart?: number;
    scaleEnd?: number;
    panX?: number;
    panY?: number;
  } = {},
): { scale: number; translateX: number; translateY: number } {
  const { scaleStart = 1.0, scaleEnd = 1.15, panX = 0, panY = 0 } = opts;

  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return {
    scale: interpolate(progress, [0, 1], [scaleStart, scaleEnd]),
    translateX: interpolate(progress, [0, 1], [0, panX]),
    translateY: interpolate(progress, [0, 1], [0, panY]),
  };
}

export function countUp(
  frame: number,
  fps: number,
  target: number,
  delay = 0,
  durationSec = 1.5,
): number {
  const durationFrames = durationSec * fps;
  const progress = interpolate(frame - delay, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Ease out cubic
  const eased = 1 - (1 - progress) ** 3;
  return Math.round(eased * target);
}
