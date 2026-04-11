import { useParams } from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { EpicDetail } from "../components/EpicDetail";

export function EpicDetailPage() {
  const { epicId } = useParams({ from: "/p/$projectSlug/epics/$epicId" });

  return <EpicDetail epicId={epicId as Id<"epics">} />;
}
