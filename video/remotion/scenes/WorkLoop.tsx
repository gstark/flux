import type React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { FadeTransition } from "../components/FadeTransition";
import { Screenshot } from "../components/Screenshot";
import { TextOverlay } from "../components/TextOverlay";

export const WorkLoop: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const splitAt = Math.floor(durationInFrames * 0.55);

  return (
    <FadeTransition>
      {/* Agent transcript — slow pan down, slight zoom */}
      <Sequence durationInFrames={splitAt}>
        <Screenshot
          src="screenshots/session-work-detail.png"
          scaleStart={1.0}
          scaleEnd={1.06}
          panY={-20}
        />
        <TextOverlay
          text="Agent builds, validates, commits."
          subtitle="Yes, it runs curl to check its own work. We're all terrified too."
          position="bottom-left"
          fontSize={40}
          delay={15}
        />
      </Sequence>

      {/* Issue resolved — static */}
      <Sequence from={splitAt} durationInFrames={durationInFrames - splitAt}>
        <Screenshot
          src="screenshots/flux-sessions.png"
          scaleStart={1.0}
          scaleEnd={1.03}
        />
        <TextOverlay
          text="Session complete. Issue resolved."
          position="bottom"
          fontSize={40}
          delay={8}
        />
      </Sequence>

      <Audio src={staticFile("audio/vo-work.mp3")} />
    </FadeTransition>
  );
};
