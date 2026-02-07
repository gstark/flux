import { useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";

export function SettingsForm() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const project = useQuery(api.projects.getById, { projectId });
  const config = useQuery(api.orchestratorConfig.get, { projectId });
  const epics = useQuery(api.epics.list, { projectId });
  const updateConfig = useMutation(api.orchestratorConfig.update);

  // Local form state — initialized from config once loaded
  const [focusEpicId, setFocusEpicId] = useState<string>("all");
  const [maxReviewIterations, setMaxReviewIterations] = useState("");
  const [maxFailures, setMaxFailures] = useState("");
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState("");

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sync form state from server config
  useEffect(() => {
    if (!config) return;
    setFocusEpicId(config.focusEpicId ?? "all");
    setMaxReviewIterations(String(config.maxReviewIterations));
    setMaxFailures(String(config.maxFailures));
    setSessionTimeoutMin(String(Math.round(config.sessionTimeoutMs / 60_000)));
    setDirty(false);
  }, [config]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const reviewIter = Number(maxReviewIterations);
    const failures = Number(maxFailures);
    const timeoutMin = Number(sessionTimeoutMin);

    if (!Number.isInteger(reviewIter) || reviewIter < 1) {
      setError("Max Review Iterations must be a positive integer");
      return;
    }
    if (!Number.isInteger(failures) || failures < 1) {
      setError("Max Failures must be a positive integer");
      return;
    }
    if (!Number.isInteger(timeoutMin) || timeoutMin < 1) {
      setError("Session Timeout must be a positive integer (minutes)");
      return;
    }

    setSaving(true);
    try {
      await updateConfig({
        projectId,
        maxReviewIterations: reviewIter,
        maxFailures: failures,
        sessionTimeoutMs: timeoutMin * 60_000,
        focusEpicId:
          focusEpicId === "all" ? null : (focusEpicId as Id<"epics">),
      });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  // Loading state
  if (config === undefined || project === undefined || epics === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  // No config exists yet — prompt user
  if (config === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-bold text-xl">Settings</h1>
        <div className="rounded-lg border border-base-300 bg-base-200 p-6">
          <p className="text-base-content/70">
            No orchestrator configuration found. Enable the orchestrator from
            the navbar to create a default configuration, then return here to
            customize it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-bold text-xl">Settings</h1>

      {/* Project section */}
      <section className="rounded-lg border border-base-300 bg-base-200 p-4">
        <h2 className="mb-3 font-semibold text-lg">Project</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Project Name</legend>
            <input
              type="text"
              className="input input-bordered w-full"
              value={project?.name ?? ""}
              readOnly
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Project ID</legend>
            <input
              type="text"
              className="input input-bordered w-full font-mono text-sm"
              value={projectId}
              readOnly
            />
          </fieldset>
        </div>
      </section>

      {/* Scheduler section */}
      <form onSubmit={handleSave}>
        <section className="rounded-lg border border-base-300 bg-base-200 p-4">
          <h2 className="mb-3 font-semibold text-lg">Scheduler</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Focus Epic</legend>
              <select
                className="select select-bordered w-full"
                value={focusEpicId}
                onChange={(e) => {
                  setFocusEpicId(e.target.value);
                  markDirty();
                }}
              >
                <option value="all">All (no restriction)</option>
                {epics.map((epic) => (
                  <option key={epic._id} value={epic._id}>
                    {epic.title}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">Max Review Iterations</legend>
              <input
                type="number"
                className="input input-bordered w-full"
                min={1}
                step={1}
                value={maxReviewIterations}
                onChange={(e) => {
                  setMaxReviewIterations(e.target.value);
                  markDirty();
                }}
              />
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">
                Max Failures (circuit breaker)
              </legend>
              <input
                type="number"
                className="input input-bordered w-full"
                min={1}
                step={1}
                value={maxFailures}
                onChange={(e) => {
                  setMaxFailures(e.target.value);
                  markDirty();
                }}
              />
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">
                Session Timeout (minutes)
              </legend>
              <input
                type="number"
                className="input input-bordered w-full"
                min={1}
                step={1}
                value={sessionTimeoutMin}
                onChange={(e) => {
                  setSessionTimeoutMin(e.target.value);
                  markDirty();
                }}
              />
            </fieldset>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving || !dirty}
            >
              {saving && (
                <span className="loading loading-spinner loading-sm" />
              )}
              Save Changes
            </button>
            {saved && (
              <span className="text-sm text-success">Settings saved</span>
            )}
            {error && <span className="text-error text-sm">{error}</span>}
          </div>
        </section>
      </form>
    </div>
  );
}
