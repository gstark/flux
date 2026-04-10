/**
 * Read and parse the .flux config file from a project root.
 *
 * Supports two formats:
 * 1. **Bare ID** (legacy) — file contains only a Convex document ID
 * 2. **TOML** — structured config with `project = "..."` and optional `[planner]` section
 *
 * Uses Bun.TOML.parse() — zero dependencies.
 */

export interface FluxConfig {
  projectId: string;
  planner?: {
    schedule?: string;
    agenda?: string;
  };
}

/**
 * Read and parse the .flux file at the given project path.
 * Returns null if no .flux file exists or it's empty.
 */
export async function readFluxConfig(
  projectPath: string,
): Promise<FluxConfig | null> {
  const fluxFile = Bun.file(`${projectPath}/.flux`);
  if (!(await fluxFile.exists())) return null;

  const raw = (await fluxFile.text()).trim();
  if (!raw) return null;

  // Try TOML first — if the content has `=` or `[`, it's TOML format
  if (raw.includes("=") || raw.includes("[")) {
    try {
      const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
      const projectId = parsed.project;
      if (typeof projectId !== "string" || !projectId) {
        throw new Error('.flux TOML is missing required "project" field');
      }

      let planner: FluxConfig["planner"];
      const plannerSection = parsed.planner as
        | Record<string, unknown>
        | undefined;
      if (plannerSection && typeof plannerSection === "object") {
        planner = {
          schedule:
            typeof plannerSection.schedule === "string"
              ? plannerSection.schedule
              : undefined,
          agenda:
            typeof plannerSection.agenda === "string"
              ? plannerSection.agenda
              : undefined,
        };
      }

      return { projectId, planner };
    } catch (err) {
      // If TOML parsing fails, fall through to bare ID
      if (err instanceof Error && err.message.includes("missing required")) {
        throw err; // Re-throw validation errors
      }
      console.warn(
        `[fluxConfig] Failed to parse .flux as TOML, treating as bare ID:`,
        err,
      );
    }
  }

  // Bare ID fallback — the entire file content is the project ID
  return { projectId: raw };
}
