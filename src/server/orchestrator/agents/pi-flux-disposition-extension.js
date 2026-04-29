export default function registerFluxDispositionExtension(pi) {
  pi.registerTool({
    name: "flux_report_disposition",
    label: "Report Flux Disposition",
    description:
      "Report the final Flux session disposition and note when the assigned work is complete.",
    parameters: {
      type: "object",
      properties: {
        disposition: {
          type: "string",
          enum: ["done", "noop", "fault"],
          description: "Final Flux disposition for the session.",
        },
        note: {
          type: "string",
          description:
            "Short explanation of what was accomplished, why no work was needed, or what blocked completion.",
        },
      },
      required: ["disposition", "note"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      return {
        content: [
          {
            type: "text",
            text: `Recorded Flux disposition: ${params.disposition}`,
          },
        ],
        details: {
          disposition: params.disposition,
          note: params.note,
        },
      };
    },
  });
}
