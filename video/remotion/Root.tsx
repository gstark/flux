import type React from "react";
import { Composition } from "remotion";
import { FPS, HEIGHT, SCENE_DURATIONS, WIDTH } from "./lib/constants";
import { Video } from "./Video";

const totalDuration = Object.values(SCENE_DURATIONS).reduce(
  (sum, d) => sum + d,
  0,
);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FluxDemo"
      component={Video}
      durationInFrames={totalDuration * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
