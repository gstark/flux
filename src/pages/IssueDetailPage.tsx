import { useParams } from "@tanstack/react-router";

export function IssueDetailPage() {
  const { issueId } = useParams({ from: "/issues/$issueId" });

  return (
    <div>
      <h2 className="font-semibold text-xl">Issue {issueId}</h2>
      <p className="mt-2 text-base-content/60">Issue detail coming soon.</p>
    </div>
  );
}
