import type React from "react";
import { Audio, staticFile } from "remotion";
import { FadeTransition } from "../components/FadeTransition";
import { Screenshot } from "../components/Screenshot";
import { TextOverlay } from "../components/TextOverlay";

export const ReviewLoop: React.FC = () => {
  return (
    <FadeTransition>
      {/* Subtle pan right, minimal zoom */}
      <Screenshot
        src="screenshots/session-review-detail.png"
        scaleStart={1.0}
        scaleEnd={1.04}
        panX={10}
      />
      <TextOverlay
        text="A fresh review agent reads the diff."
        subtitle="Ruthlessly. Without any of the social pressure to just approve."
        position="bottom"
        fontSize={40}
        delay={10}
      />
      <Audio src={staticFile("audio/vo-review.mp3")} />
    </FadeTransition>
  );
};
