export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Scene durations in seconds — sized to fit actual VO audio + 0.5s pad
// 60s cut: highlights trimmed to 3 examples, stats+close combined, memes inset over scenes
export const SCENE_DURATIONS = {
  disclaimer: 3,
  coldOpen: 3,
  handoff: 8,
  workLoop: 11,
  retroLoop: 10.5,
  reviewLoop: 7,
  highlights: 9.5,
  statsClose: 8,
} as const;

// Colors
export const COLORS = {
  bg: "#0f172a", // slate-900
  text: "#f8fafc", // slate-50
  accent: "#3b82f6", // blue-500
  muted: "#94a3b8", // slate-400
  highlight: "#22d3ee", // cyan-400
} as const;
