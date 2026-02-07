import { useParams } from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { IssueDetail } from "../components/IssueDetail";

export function IssueDetailPage() {
  const { issueId } = useParams({ from: "/issues/$issueId" });

  return <IssueDetail issueId={issueId as Id<"issues">} />;
}
