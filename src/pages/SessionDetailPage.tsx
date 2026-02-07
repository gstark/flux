import { useParams } from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { SessionDetail } from "../components/SessionDetail";

export function SessionDetailPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });

  return <SessionDetail sessionId={sessionId as Id<"sessions">} />;
}
