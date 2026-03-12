import type React from "react";
import { Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fadeIn, fadeOut, slideUp } from "../lib/animations";
import { COLORS } from "../lib/constants";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";

// Excerpted from docs/design.md — the real Flux PRD
const PRD_LINES = [
  { id: "title", type: "h1", text: "FLUX Design Document" },
  { id: "b1", type: "blank", text: "" },
  { id: "summary-h", type: "h2", text: "Summary" },
  { id: "b2", type: "blank", text: "" },
  {
    id: "summary-p",
    type: "p",
    text: "An autonomous agent orchestrator with built-in issue tracking, realtime UI, and its own MCP server.",
  },
  { id: "b3", type: "blank", text: "" },
  { id: "arch-h", type: "h2", text: "Architecture" },
  { id: "b4", type: "blank", text: "" },
  {
    id: "c01",
    type: "code",
    text: "┌─────────────────────────────────────────────────┐",
  },
  {
    id: "c02",
    type: "code",
    text: "│            Bun Server (port 8042)               │",
  },
  {
    id: "c03",
    type: "code",
    text: "│  ┌─────────────────────────────────────────┐    │",
  },
  {
    id: "c04",
    type: "code",
    text: "│  │  React Frontend (HTML import)           │    │",
  },
  {
    id: "c05",
    type: "code",
    text: "│  │  - useQuery (realtime)                  │    │",
  },
  {
    id: "c06",
    type: "code",
    text: "│  │  - useMutation                          │    │",
  },
  {
    id: "c07",
    type: "code",
    text: "│  └─────────────────────────────────────────┘    │",
  },
  {
    id: "c08",
    type: "code",
    text: "│  ┌─────────────────────────────────────────┐    │",
  },
  {
    id: "c09",
    type: "code",
    text: "│  │  Orchestrator                           │    │",
  },
  {
    id: "c10",
    type: "code",
    text: "│  │  ├── Scheduler → subscribe issues.ready │    │",
  },
  {
    id: "c11",
    type: "code",
    text: "│  │  ├── Executor  → spawn claude CLI       │    │",
  },
  {
    id: "c12",
    type: "code",
    text: "│  │  └── Feedback  → retro + review loop    │    │",
  },
  {
    id: "c13",
    type: "code",
    text: "│  └─────────────────────────────────────────┘    │",
  },
  {
    id: "c14",
    type: "code",
    text: "└─────────────────────────────────────────────────┘",
  },
] as const;

const LINE_HEIGHT = 32;

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const docOpacity = fadeIn(frame, fps) * fadeOut(frame, fps, durationInFrames);
  const overlayY = slideUp(frame, fps, 20);
  const overlayOpacity =
    fadeIn(frame, fps, 20) * fadeOut(frame, fps, durationInFrames);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#1a1b26",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        opacity: docOpacity,
      }}
    >
      {/* Editor chrome */}
      <div
        style={{
          width: 1400,
          background: "#16161e",
          borderRadius: 16,
          border: "1px solid #2a2b3d",
          overflow: "hidden",
          boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            background: "#1a1b26",
            borderBottom: "1px solid #2a2b3d",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: "#ff5f57",
            }}
          />
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: "#febc2e",
            }}
          />
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: "#28c840",
            }}
          />
          <div
            style={{
              marginLeft: 12,
              color: "#565f89",
              fontSize: 13,
              fontFamily: FONT_MONO,
            }}
          >
            docs/design.md
          </div>
        </div>

        {/* Document content */}
        <div
          style={{ padding: "28px 48px", maxHeight: 700, overflow: "hidden" }}
        >
          {PRD_LINES.map((line) => {
            if (line.type === "blank") {
              return (
                <div key={line.id} style={{ height: LINE_HEIGHT * 0.5 }} />
              );
            }

            const baseStyle: React.CSSProperties = {
              lineHeight: `${LINE_HEIGHT}px`,
              whiteSpace: "pre",
            };

            if (line.type === "h1") {
              return (
                <div
                  key={line.id}
                  style={{
                    ...baseStyle,
                    color: "#c0caf5",
                    fontSize: 36,
                    fontWeight: 700,
                    fontFamily: FONT_DISPLAY,
                    lineHeight: "48px",
                  }}
                >
                  {line.text}
                </div>
              );
            }

            if (line.type === "h2") {
              return (
                <div
                  key={line.id}
                  style={{
                    ...baseStyle,
                    color: "#7aa2f7",
                    fontSize: 24,
                    fontWeight: 600,
                    fontFamily: FONT_DISPLAY,
                    lineHeight: "36px",
                  }}
                >
                  {line.text}
                </div>
              );
            }

            if (line.type === "code") {
              return (
                <div
                  key={line.id}
                  style={{
                    ...baseStyle,
                    color: "#565f89",
                    fontSize: 16,
                    fontFamily: FONT_MONO,
                    lineHeight: "24px",
                  }}
                >
                  {line.text}
                </div>
              );
            }

            return (
              <div
                key={line.id}
                style={{
                  ...baseStyle,
                  color: "#a9b1d6",
                  fontSize: 20,
                  fontWeight: 400,
                  fontFamily: FONT_DISPLAY,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* "You write the PRD" overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: "50%",
          transform: `translateX(-50%) translateY(${overlayY}px)`,
          opacity: overlayOpacity,
          zIndex: 10,
        }}
      >
        <div
          style={{
            background: "rgba(15, 23, 42, 0.9)",
            backdropFilter: "blur(8px)",
            padding: "24px 64px",
            borderRadius: 16,
            border: `1px solid ${COLORS.accent}33`,
          }}
        >
          <div
            style={{
              color: COLORS.text,
              fontSize: 56,
              fontWeight: 600,
              fontFamily: FONT_DISPLAY,
            }}
          >
            You write the PRD.
          </div>
        </div>
      </div>

      <Audio src={staticFile("audio/vo-cold-open.mp3")} />
    </div>
  );
};
