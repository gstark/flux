import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import type { Id } from "$convex/_generated/dataModel";
import type {
  SessionPhaseValue,
  SessionStatusValue,
  SessionTypeValue,
} from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import {
  formatDuration,
  formatRelativeTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import { FontAwesomeIcon, faChevronRight } from "./Icon";
import { SessionStatusBadge } from "./SessionStatusBadge";

type SessionRowSession = {
  _id: Id<"sessions">;
  type: SessionTypeValue;
  status: SessionStatusValue;
  phase?: SessionPhaseValue;
  agent: string;
  startedAt: number;
  endedAt?: number;
  note?: string | null;
  transitionSummary?: string | null;
};

export function buildSessionSummary(session: {
  status: SessionStatusValue;
  phase?: SessionPhaseValue;
  note?: string | null;
  transitionSummary?: string | null;
}) {
  const parts: Array<{ label: string; content: string }> = [];

  if (session.transitionSummary) {
    parts.push({
      label: "Status summary",
      content: session.transitionSummary,
    });
  } else if (session.status === SessionStatus.Running) {
    parts.push({
      label: "Status summary",
      content: session.phase
        ? `Still running in ${phaseLabel(session.phase)}.`
        : "Still running.",
    });
  }

  if (session.note) {
    parts.push({
      label: "Agent note",
      content: session.note,
    });
  }

  return parts;
}

type SessionTableRowProps = {
  session: SessionRowSession;
  projectSlug: string;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  detailColSpan: number;
  rowClassName?: string;
  mainLinkClassName?: string;
  textLinkClassName?: string;
  extraCells?: ReactNode;
};

export function SessionTableRow({
  session,
  projectSlug,
  isExpanded = false,
  onToggleExpanded,
  detailColSpan,
  rowClassName,
  mainLinkClassName = "block px-4 py-3",
  textLinkClassName = "block px-4 py-3 text-sm",
  extraCells,
}: SessionTableRowProps) {
  const summaryParts = buildSessionSummary(session);
  const hasSummary = summaryParts.length > 0;

  return (
    <Fragment>
      <tr className={rowClassName}>
        <td className="w-0 px-2 py-0 align-top">
          {hasSummary ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} session details`}
              className="flex h-full min-h-12 items-center py-3 text-base-content/50 transition-colors hover:text-base-content"
              onClick={onToggleExpanded}
            >
              <FontAwesomeIcon
                icon={faChevronRight}
                aria-hidden="true"
                className={`text-xs transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>
          ) : (
            <span className="block w-3" aria-hidden="true" />
          )}
        </td>
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={mainLinkClassName}
          >
            {typeLabel(session.type)}
          </Link>
        </td>
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={textLinkClassName}
          >
            {session.phase ? phaseLabel(session.phase) : "—"}
          </Link>
        </td>
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={mainLinkClassName}
          >
            <SessionStatusBadge status={session.status} />
          </Link>
        </td>
        {extraCells}
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={textLinkClassName}
          >
            {session.agent}
          </Link>
        </td>
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={textLinkClassName}
          >
            {formatRelativeTime(session.startedAt)}
          </Link>
        </td>
        <td className="p-0">
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: session._id }}
            className={textLinkClassName}
          >
            {formatDuration(session.startedAt, session.endedAt)}
          </Link>
        </td>
      </tr>
      {hasSummary && (
        <tr className="bg-base-200/40">
          <td
            colSpan={detailColSpan}
            className={`border-base-300/60 border-t-0 px-0 pt-0 transition-[padding] duration-200 ${isExpanded ? "pb-3" : "pb-0"}`}
          >
            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
            >
              <div className="overflow-hidden">
                <div
                  className={`mr-4 ml-11 rounded-lg border border-base-300/60 bg-base-100/80 px-4 py-3 shadow-sm transition-transform duration-200 ease-out ${isExpanded ? "translate-y-0" : "-translate-y-1"}`}
                >
                  <div className="space-y-3">
                    {summaryParts.map((part) => (
                      <div key={part.label} className="space-y-1">
                        <div className="font-medium text-base-content/70 text-xs uppercase tracking-wide">
                          {part.label}
                        </div>
                        <p className="whitespace-pre-wrap break-words pl-4 text-sm leading-6">
                          {part.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
