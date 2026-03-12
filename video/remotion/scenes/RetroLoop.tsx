import type React from "react";
import { Audio, staticFile } from "remotion";
import { FadeTransition } from "../components/FadeTransition";
import { Screenshot } from "../components/Screenshot";
import { TextOverlay } from "../components/TextOverlay";

export const RetroLoop: React.FC = () => {
  return (
    <FadeTransition>
      {/* Very subtle zoom only */}
      <Screenshot
        src="screenshots/session-retro-detail.png"
        scaleStart={1.0}
        scaleEnd={1.04}
      />
      <TextOverlay
        text={`"No input validation on request bodies."`}
        subtitle="Imagine if your coworkers filed bugs against their own PRs."
        position="bottom"
        fontSize={40}
        delay={15}
      />
      <Audio src={staticFile("audio/vo-retro.mp3")} />
    </FadeTransition>
  );
};
