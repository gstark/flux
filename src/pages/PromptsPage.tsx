import { useState } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { faChevronRight, FontAwesomeIcon } from "../components/Icon";
import { getDefaultPromptTemplates } from "../server/orchestrator/agents/prompts";

const PROMPTS = [
  {
    key: "work" as const,
    name: "Work",
    description:
      "Sent to the agent when starting a new session to implement an issue. Includes issue context, tenets, commit guidance, and MCP tool instructions.",
  },
  {
    key: "retro" as const,
    name: "Retro",
    description:
      "Sent after the work phase completes, in the same session. Asks the agent to reflect on friction, process improvements, and code stewardship.",
  },
  {
    key: "review" as const,
    name: "Review",
    description:
      "Sent to a fresh session after the retro phase. The agent reviews the diff, fixes issues inline, and files follow-up issues.",
  },
  {
    key: "planner" as const,
    name: "Planner",
    description:
      "Sent to the planner agent during backlog maintenance. Instructs it to survey, reprioritize, seed, and prune the issue queue.",
  },
] as const;

const templates = getDefaultPromptTemplates();

function PromptCard({
  prompt,
  isOpen,
  onToggle,
}: {
  prompt: (typeof PROMPTS)[number];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-box border border-base-300/60 bg-base-200/70 shadow-sm transition-colors duration-200">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`prompt-panel-${prompt.key}`}
      >
        <div>
          <span className="text-base">The {prompt.name} Prompt</span>
          <p className="mt-0.5 font-normal text-base-content/60 text-sm leading-6">
            {prompt.description}
          </p>
        </div>
        <FontAwesomeIcon
          icon={faChevronRight}
          aria-hidden="true"
          className={`shrink-0 text-sm text-base-content/50 transition-transform duration-200 ease-out ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      <div
        id={`prompt-panel-${prompt.key}`}
        aria-hidden={!isOpen}
        className={`overflow-hidden px-5 transition-[max-height,opacity,padding-bottom] duration-200 ease-out ${isOpen ? "max-h-[70vh] pb-5 opacity-100" : "max-h-0 pb-0 opacity-0"}`}
      >
        <div
          className={`rounded-xl border border-base-300/60 bg-base-300/80 p-4 shadow-sm transition-transform duration-200 ease-out ${isOpen ? "translate-y-0" : "-translate-y-1"}`}
        >
          {templates[prompt.key] ? (
            <pre className="max-h-[60vh] overflow-x-auto overflow-y-auto whitespace-pre-wrap text-xs leading-5">
              {templates[prompt.key]}
            </pre>
          ) : (
            <p className="text-base-content/60 text-sm italic">No prompt</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PromptsPage() {
  useDocumentTitle("Prompts");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="max-w-4xl p-6">
      <h1 className="mb-2 font-bold text-2xl">Agent Prompts</h1>
      <p className="mb-6 text-base-content/60">
        Built-in prompts used by the Flux orchestrator. Custom prompts can be
        configured per-project in{" "}
        <span className="font-medium text-base-content">Settings</span>.
      </p>

      <div className="flex flex-col gap-3">
        {PROMPTS.map((prompt) => {
          const isOpen = open === prompt.key;
          return (
            <PromptCard
              key={prompt.key}
              prompt={prompt}
              isOpen={isOpen}
              onToggle={() => setOpen(isOpen ? null : prompt.key)}
            />
          );
        })}
      </div>
    </div>
  );
}
