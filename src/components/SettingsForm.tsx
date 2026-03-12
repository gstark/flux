import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { AgentKind, type AgentKindValue } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import { useTrackedAction } from "../hooks/useTrackedAction";
import { useUpdateProject } from "../hooks/useUpdateProject";
import { ErrorBanner } from "./ErrorBanner";

export function SettingsForm() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const { navigate } = useRouter();
  const project = useQuery(api.projects.getById, { projectId });
  const config = useQuery(api.orchestratorConfig.get, { projectId });
  const epics = useQuery(api.epics.list, { projectId });
  const { save: saveProjectFields, saving: savingProject } =
    useUpdateProject(projectId);
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);
  const updateConfig = useMutation(api.orchestratorConfig.update);

  // ── Project identity form state ──────────────────────────────────
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [projectDirty, setProjectDirty] = useState(false);
  const [projectSaved, setProjectSaved] = useState(false);
  const {
    error: projectError,
    showError: showProjectError,
    clearError: clearProjectError,
  } = useDismissableError();

  const [saveProject] = useTrackedAction(async () => {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();

    if (!trimmedName) {
      showProjectError("Project name is required");
      return;
    }

    const nameChanged = trimmedName !== project?.name;
    const pathChanged = trimmedPath !== (project?.path ?? "");

    if (!nameChanged && !pathChanged) {
      setProjectDirty(false);
      setProjectSaved(true);
      return;
    }

    await saveProjectFields({
      ...(nameChanged ? { name: trimmedName } : {}),
      ...(pathChanged ? { path: trimmedPath } : {}),
    });

    setProjectDirty(false);
    setProjectSaved(true);
  }, showProjectError);

  // Sync project form state from server
  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setPath(project.path ?? "");
    setProjectDirty(false);
  }, [project]);

  function markProjectDirty() {
    setProjectDirty(true);
    setProjectSaved(false);
  }

  function handleProjectSave(e: React.FormEvent) {
    e.preventDefault();
    clearProjectError();
    saveProject();
  }

  // ── Orchestrator config form state ───────────────────────────────
  const [focusEpicId, setFocusEpicId] = useState<string>("all");
  const [agent, setAgent] = useState<AgentKindValue>(AgentKind.Claude);
  const [maxReviewIterations, setMaxReviewIterations] = useState("");
  const [maxFailures, setMaxFailures] = useState("");
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState("");
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const {
    error: configError,
    showError: showConfigError,
    clearError: clearConfigError,
  } = useDismissableError();

  const [saveConfig, savingConfig] = useTrackedAction(
    async (args: {
      agent: AgentKindValue;
      reviewIter: number;
      failures: number;
      timeoutMin: number;
    }) => {
      await updateConfig({
        projectId,
        agent: args.agent,
        maxReviewIterations: args.reviewIter,
        maxFailures: args.failures,
        sessionTimeoutMs: args.timeoutMin * 60_000,
        focusEpicId:
          focusEpicId === "all" ? null : (focusEpicId as Id<"epics">),
      });
      setConfigDirty(false);
      setConfigSaved(true);
    },
    showConfigError,
  );

  // Sync config form state from server
  useEffect(() => {
    if (!config) return;
    setAgent(config.agent);
    setFocusEpicId(config.focusEpicId ?? "all");
    setMaxReviewIterations(String(config.maxReviewIterations));
    setMaxFailures(String(config.maxFailures));
    setSessionTimeoutMin(String(Math.round(config.sessionTimeoutMs / 60_000)));
    setConfigDirty(false);
  }, [config]);

  function markConfigDirty() {
    setConfigDirty(true);
    setConfigSaved(false);
  }

  function handleConfigSave(e: React.FormEvent) {
    e.preventDefault();
    clearConfigError();

    const reviewIter = Number(maxReviewIterations);
    const failures = Number(maxFailures);
    const timeoutMin = Number(sessionTimeoutMin);

    if (!Number.isInteger(reviewIter) || reviewIter < 1) {
      showConfigError("Max Review Iterations must be a positive integer");
      return;
    }
    if (!Number.isInteger(failures) || failures < 1) {
      showConfigError("Max Failures must be a positive integer");
      return;
    }
    if (!Number.isInteger(timeoutMin) || timeoutMin < 1) {
      showConfigError("Session Timeout must be a positive integer (minutes)");
      return;
    }

    saveConfig({ agent, reviewIter, failures, timeoutMin });
  }

  // ── Project enabled toggle ──────────────────────────────────────
  const {
    error: stateError,
    showError: showStateError,
    clearError: clearStateError,
  } = useDismissableError();

  async function handleEnabledToggle() {
    clearStateError();
    try {
      await updateProject({
        projectId,
        enabled: !(project?.enabled ?? false),
      });
    } catch (err) {
      showStateError(err);
    }
  }

  // ── Danger zone: remove project ──────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState("");
  const {
    error: deleteError,
    showError: showDeleteError,
    clearError: clearDeleteError,
  } = useDismissableError();
  const [deleting, setDeleting] = useState(false);

  const deleteInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (confirmDelete) deleteInputRef.current?.focus();
  }, [confirmDelete]);

  async function handleDelete() {
    if (deleteSlug !== projectSlug) return;
    setDeleting(true);
    try {
      await removeProject({ projectId });
      navigate({ to: "/" });
    } catch (err) {
      showDeleteError(err);
      setDeleting(false);
    }
  }

  // ── Loading state ────────────────────────────────────────────────
  if (project === undefined || config === undefined || epics === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-bold text-xl">Settings</h1>
        <div className="rounded-lg border border-error/30 bg-base-200 p-6">
          <p className="text-base-content/70">
            Project not found. It may have been removed.
          </p>
        </div>
      </div>
    );
  }

  const isEnabled = project.enabled ?? false;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-bold text-xl">Settings</h1>

      {/* ── Project Identity ─────────────────────────────────────── */}
      <form onSubmit={handleProjectSave}>
        <section className="rounded-lg border border-base-300 bg-base-200 p-4">
          <h2 className="mb-3 font-semibold text-lg">Project</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Name</legend>
              <input
                type="text"
                className="input w-full"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  markProjectDirty();
                }}
                placeholder="Project name"
              />
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">Slug</legend>
              <input
                type="text"
                className="input w-full font-mono text-sm"
                value={projectSlug}
                readOnly
                title="Slug is read-only"
              />
            </fieldset>

            <fieldset className="fieldset sm:col-span-2">
              <legend className="fieldset-legend">Project ID</legend>
              <input
                type="text"
                className="input w-full font-mono text-sm"
                value={projectId}
                readOnly
                title="Click to copy"
                onClick={(e) => {
                  const input = e.currentTarget;
                  input.select();
                  navigator.clipboard.writeText(projectId);
                }}
              />
            </fieldset>

            <fieldset className="fieldset sm:col-span-2">
              <legend className="fieldset-legend">Path</legend>
              <input
                type="text"
                className="input w-full font-mono text-sm"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  markProjectDirty();
                }}
                placeholder="/path/to/repository"
              />
            </fieldset>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={savingProject || !projectDirty}
            >
              {savingProject && (
                <span className="loading loading-spinner loading-sm" />
              )}
              Save Changes
            </button>
            {projectSaved && (
              <span className="text-sm text-success">Saved</span>
            )}
          </div>
          <ErrorBanner error={projectError} onDismiss={clearProjectError} />
        </section>
      </form>

      {/* ── Orchestrator Config ──────────────────────────────────── */}
      {config === null ? (
        <section className="rounded-lg border border-base-300 bg-base-200 p-4">
          <h2 className="mb-3 font-semibold text-lg">Orchestrator</h2>
          <p className="text-base-content/70">
            No orchestrator configuration found. Set the project state to
            &ldquo;Running&rdquo; to create a default configuration, then return
            here to customize it.
          </p>
        </section>
      ) : (
        <form onSubmit={handleConfigSave}>
          <section className="rounded-lg border border-base-300 bg-base-200 p-4">
            <h2 className="mb-3 font-semibold text-lg">Orchestrator</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Agent Runner</legend>
                <select
                  className="select w-full"
                  value={agent}
                  onChange={(e) => {
                    setAgent(e.target.value as AgentKindValue);
                    markConfigDirty();
                  }}
                >
                  <option value={AgentKind.Claude}>Claude Code</option>
                  <option value={AgentKind.Codex}>Codex (coming soon)</option>
                  <option value={AgentKind.OpenCode}>
                    OpenCode (coming soon)
                  </option>
                </select>
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">Focus Epic</legend>
                <select
                  className="select w-full"
                  value={focusEpicId}
                  onChange={(e) => {
                    setFocusEpicId(e.target.value);
                    markConfigDirty();
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
                <legend className="fieldset-legend">
                  Max Review Iterations
                </legend>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  step={1}
                  value={maxReviewIterations}
                  onChange={(e) => {
                    setMaxReviewIterations(e.target.value);
                    markConfigDirty();
                  }}
                />
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">
                  Max Failures (circuit breaker)
                </legend>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  step={1}
                  value={maxFailures}
                  onChange={(e) => {
                    setMaxFailures(e.target.value);
                    markConfigDirty();
                  }}
                />
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">
                  Session Timeout (minutes)
                </legend>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  step={1}
                  value={sessionTimeoutMin}
                  onChange={(e) => {
                    setSessionTimeoutMin(e.target.value);
                    markConfigDirty();
                  }}
                />
              </fieldset>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={savingConfig || !configDirty}
              >
                {savingConfig && (
                  <span className="loading loading-spinner loading-sm" />
                )}
                Save Changes
              </button>
              {configSaved && (
                <span className="text-sm text-success">Saved</span>
              )}
            </div>
            <p className="mt-3 text-base-content/60 text-sm">
              Codex and OpenCode selection is wired through configuration and
              runner lifecycle, but their process adapters are not implemented
              yet. Selecting either will fail fast when a session tries to
              start.
            </p>
            <ErrorBanner error={configError} onDismiss={clearConfigError} />
          </section>
        </form>
      )}

      {/* ── Project Enabled ──────────────────────────────────────── */}
      <section className="rounded-lg border border-base-300 bg-base-200 p-4">
        <h2 className="mb-3 font-semibold text-lg">Scheduling</h2>
        <label
          htmlFor="project-enabled"
          className="flex cursor-pointer items-center gap-3"
        >
          <input
            id="project-enabled"
            type="checkbox"
            className="toggle toggle-success"
            checked={isEnabled}
            onChange={handleEnabledToggle}
          />
          <div>
            <div className="font-medium">
              {isEnabled ? "Enabled" : "Disabled"}
            </div>
            <div className="text-base-content/60 text-sm">
              {isEnabled
                ? "Orchestrator actively picks up ready issues"
                : "Orchestrator will not pick up new issues"}
            </div>
          </div>
        </label>
        <ErrorBanner error={stateError} onDismiss={clearStateError} />
      </section>

      {/* ── Danger Zone ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-error/30 bg-base-200 p-4">
        <h2 className="mb-3 font-semibold text-error text-lg">Danger Zone</h2>
        {confirmDelete ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              This will permanently remove the project and all its issues,
              sessions, and configuration. This action cannot be undone.
            </p>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">
                Type <code className="font-bold font-mono">{projectSlug}</code>{" "}
                to confirm
              </legend>
              <input
                ref={deleteInputRef}
                type="text"
                className="input input-bordered w-full font-mono text-sm"
                value={deleteSlug}
                onChange={(e) => setDeleteSlug(e.target.value)}
                placeholder={projectSlug}
              />
            </fieldset>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-error btn-sm"
                disabled={deleteSlug !== projectSlug || deleting}
                onClick={handleDelete}
              >
                {deleting && (
                  <span className="loading loading-spinner loading-sm" />
                )}
                Delete this project
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteSlug("");
                  clearDeleteError();
                }}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
            <ErrorBanner error={deleteError} onDismiss={clearDeleteError} />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Remove project</div>
              <div className="text-base-content/60 text-sm">
                Permanently delete this project and all associated data.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-error btn-sm"
              onClick={() => setConfirmDelete(true)}
            >
              Remove project
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
