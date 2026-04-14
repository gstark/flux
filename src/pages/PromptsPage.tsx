import { useState } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
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
            <div key={prompt.key} className="collapse rounded-box bg-base-200">
              <button
                type="button"
                className="collapse-title flex w-full items-center justify-between text-left font-semibold"
                onClick={() => setOpen(isOpen ? null : prompt.key)}
                aria-expanded={isOpen}
              >
                <div>
                  <span className="text-base">{prompt.name} Prompt</span>
                  <p className="mt-0.5 font-normal text-base-content/60 text-sm">
                    {prompt.description}
                  </p>
                </div>
                <span
                  className={`ml-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                  aria-hidden="true"
                >
                  ▶
                </span>
              </button>
              {isOpen && (
                <div className="collapse-content">
                  <pre className="max-h-[60vh] overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded bg-base-300 p-4 text-xs">
                    {templates[prompt.key]}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
