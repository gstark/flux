import type React from "react";
import {
  Audio,
  interpolate,
  Sequence,
  Series,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MemeInset } from "./components/MemeInset";
import { COLORS, FPS, SCENE_DURATIONS } from "./lib/constants";
import { FONT_DISPLAY } from "./lib/fonts";
import { ColdOpen } from "./scenes/ColdOpen";
import { Disclaimer } from "./scenes/Disclaimer";
import { Handoff } from "./scenes/Handoff";
import { Highlights } from "./scenes/Highlights";
import { RetroLoop } from "./scenes/RetroLoop";
import { ReviewLoop } from "./scenes/ReviewLoop";
import { StatsClose } from "./scenes/StatsClose";
import { WorkLoop } from "./scenes/WorkLoop";

/** "Just kidding" overlay — spans from Disclaimer into ColdOpen */
const JustKiddingOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeInVal = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.5, stiffness: 100 },
  });

  // Fade out over the last 20 frames
  const fadeOutVal =
    frame > durationInFrames - 20
      ? interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const opacity = fadeInVal * fadeOutVal;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 20,
        opacity,
        gap: 24,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(12px)",
          padding: "40px 80px",
          borderRadius: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            color: COLORS.highlight,
            fontSize: 48,
            fontWeight: 700,
            fontFamily: FONT_DISPLAY,
            textAlign: "center",
          }}
        >
          Just kidding.
        </div>
        <div
          style={{
            color: COLORS.muted,
            fontSize: 28,
            fontWeight: 400,
            fontFamily: FONT_DISPLAY,
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.5,
          }}
        >
          This entire video — script, voiceover, memes, editing —{"\n"}
          was made by AI. The screenshots are real though.
        </div>
      </div>
    </div>
  );
};

export const Video: React.FC = () => {
  return (
    <>
      {/* Background music — low volume under VO */}
      <Audio src={staticFile("audio/bg-music.mp3")} volume={0.12} />

      {/* "Just kidding" overlay: appears 2.5s in, lasts 3s (spans into ColdOpen) */}
      <Sequence from={Math.floor(FPS * 2.5)} durationInFrames={FPS * 3}>
        <JustKiddingOverlay />
      </Sequence>

      <Series>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.disclaimer * FPS}>
          <Disclaimer />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.coldOpen * FPS}>
          <ColdOpen />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.handoff * FPS}>
          <Handoff />
          {/* Meme inset: appears 3s into handoff, lasts 4s */}
          <Sequence from={90} durationInFrames={120}>
            <MemeInset src="memes/meme-handoff.png" />
          </Sequence>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.workLoop * FPS}>
          <WorkLoop />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.retroLoop * FPS}>
          <RetroLoop />
          {/* Meme inset: appears 4s into retro, lasts 4s */}
          <Sequence from={120} durationInFrames={120}>
            <MemeInset src="memes/meme-self-review.png" />
          </Sequence>
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.reviewLoop * FPS}>
          <ReviewLoop />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.highlights * FPS}>
          <Highlights />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENE_DURATIONS.statsClose * FPS}>
          <StatsClose />
        </Series.Sequence>
      </Series>
    </>
  );
};
