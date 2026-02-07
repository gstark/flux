import { SessionPhase, SessionType } from "$convex/schema";

type SessionTypeValue = (typeof SessionType)[keyof typeof SessionType];
type SessionPhaseValue = (typeof SessionPhase)[keyof typeof SessionPhase];

export function typeLabel(type: SessionTypeValue): string {
  switch (type) {
    case SessionType.Work:
      return "Work";
    case SessionType.Review:
      return "Review";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled session type: ${_exhaustive}`);
    }
  }
}

export function phaseLabel(phase: SessionPhaseValue): string {
  switch (phase) {
    case SessionPhase.Work:
      return "Work";
    case SessionPhase.Retro:
      return "Retro";
    case SessionPhase.Review:
      return "Review";
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled session phase: ${_exhaustive}`);
    }
  }
}

export function formatDuration(startedAt: number, endedAt?: number): string {
  if (!endedAt) return "—";
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function formatRelativeTime(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
