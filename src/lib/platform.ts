/**
 * Platform detection for keyboard shortcut display.
 * Evaluated once at module load — safe for top-level use.
 */
export const isMac: boolean = /Mac|iPhone|iPad|iPod/.test(
  navigator.platform ?? "",
);

/** Modifier key label: "⌘" on Mac, "Ctrl+" on others. */
export const modKey: string = isMac ? "⌘" : "Ctrl+";
