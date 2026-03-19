import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectId } from "../hooks/useProjectId";
import { nudgeSession } from "../lib/orchestratorApi";
import { FontAwesomeIcon, faPaperPlane } from "./Icon";

/**
 * Text input for sending nudge messages to a running agent session.
 *
 * Delivers the message to the agent's stdin via the orchestrator API,
 * allowing users to send hints, corrections, or `/btw` style messages
 * without interrupting the agent's current work.
 */
export function NudgeInput() {
  const projectId = useProjectId();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-clear feedback after 3 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setFeedback(null);
    try {
      await nudgeSession(projectId, trimmed);
      setMessage("");
      setFeedback({ type: "success", text: "Sent" });
      inputRef.current?.focus();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to send nudge";
      setFeedback({ type: "error", text: errorMessage });
    } finally {
      setSending(false);
    }
  }, [projectId, message, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          className="input input-bordered input-sm min-w-0 flex-1"
          placeholder="Send a message to the agent..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={sending || !message.trim()}
          onClick={handleSend}
        >
          {sending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />
          )}
          Send
        </button>
      </div>
      {feedback && (
        <span
          className={`text-xs ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.text}
        </span>
      )}
    </div>
  );
}
