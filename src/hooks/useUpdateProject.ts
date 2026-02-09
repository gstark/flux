import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";

/** Fields that can be updated via `useUpdateProject`. */
export interface ProjectUpdateFields {
  name?: string;
  slug?: string;
  path?: string;
}

/**
 * Centralises the "path change → REST API, otherwise → Convex mutation" routing
 * used when updating a project's identity fields.
 *
 * Returns `{ save, saving }`. `save` resolves on success and throws on failure
 * so callers can handle error display however they like.
 */
export function useUpdateProject(projectId: Id<"projects">) {
  const updateProject = useMutation(api.projects.update);
  const [saving, setSaving] = useState(false);

  const updateRef = useRef(updateProject);
  updateRef.current = updateProject;

  const save = useCallback(
    async (fields: ProjectUpdateFields) => {
      setSaving(true);
      try {
        if (fields.path !== undefined) {
          // Path changes go through the REST API for server-side git validation
          const body: Record<string, string> = { path: fields.path };
          if (fields.name !== undefined) body.name = fields.name;
          if (fields.slug !== undefined) body.slug = fields.slug;

          const res = await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(data?.error ?? `Update failed (${res.status})`);
          }
        } else {
          // No path change — use Convex mutation directly
          await updateRef.current({
            projectId,
            ...(fields.name !== undefined ? { name: fields.name } : {}),
            ...(fields.slug !== undefined ? { slug: fields.slug } : {}),
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  return { save, saving };
}
