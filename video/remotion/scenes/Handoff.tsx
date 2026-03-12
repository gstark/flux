import type React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { CodeBlock } from "../components/CodeBlock";
import { FadeTransition } from "../components/FadeTransition";
import { Screenshot } from "../components/Screenshot";
import { TextOverlay } from "../components/TextOverlay";

export const Handoff: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const halfDuration = Math.floor(durationInFrames / 2);

  return (
    <FadeTransition>
      {/* First half: terminal command — subtle pan left, no zoom */}
      <Sequence durationInFrames={halfDuration}>
        <Screenshot
          src="screenshots/dashboard.png"
          scaleStart={1.0}
          scaleEnd={1.0}
          panX={-15}
        />
        <CodeBlock
          code={`> Read the PRD and create Flux issues to implement it.\n\n  ✓ Called issues_bulk_create — 5 issues created`}
        />
      </Sequence>

      {/* Second half: board populating — static, the list speaks for itself */}
      <Sequence
        from={halfDuration}
        durationInFrames={durationInFrames - halfDuration}
      >
        <Screenshot
          src="screenshots/flux-closed-issues.png"
          scaleStart={1.0}
          scaleEnd={1.03}
        />
        <TextOverlay
          text="Tickets? In this economy?"
          subtitle="One MCP call. Priorities, descriptions, dependencies."
          position="bottom"
          fontSize={36}
          delay={10}
        />
      </Sequence>

      <Audio src={staticFile("audio/vo-handoff.mp3")} />
    </FadeTransition>
  );
};
