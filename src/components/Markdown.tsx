import type { ReactNode } from "react";

/**
 * Lightweight markdown renderer for issue descriptions, close reasons, and comments.
 * Supports: headings, fenced code blocks, inline code, bold, italic, links (markdown & bare URLs), unordered/ordered lists.
 * No external dependencies — intentionally minimal for our use case.
 */

/** Parse inline markdown (bold, italic, inline code, links) within a text string. */
function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Regex matches (priority order): inline code, markdown link, bare URL, bold, italic
  const inlinePattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(https?:\/\/[^\s<>)\]]+)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const matchIndex = match.index;
    // Push any text before this match
    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }

    const [full] = match;
    if (full.startsWith("`")) {
      // Inline code
      nodes.push(
        <code
          key={matchIndex}
          className="rounded bg-base-300 px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {full.slice(1, -1)}
        </code>,
      );
    } else if (full.startsWith("[")) {
      // Markdown link: [text](url)
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(full);
      const linkText = linkMatch?.[1];
      const linkHref = linkMatch?.[2];
      if (linkText && linkHref && /^https?:\/\//.test(linkHref)) {
        nodes.push(
          <a
            key={matchIndex}
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="link link-primary"
          >
            {parseInline(linkText)}
          </a>,
        );
      } else {
        // Re-parse failed or non-http scheme — emit raw text
        nodes.push(full);
      }
    } else if (/^https?:\/\//.test(full)) {
      // Bare URL — strip common trailing punctuation that the greedy regex captures
      const cleaned = full.replace(/[.,;:!?)]+$/, "");
      nodes.push(
        <a
          key={matchIndex}
          href={cleaned}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-primary"
        >
          {cleaned}
        </a>,
      );
      // Re-emit any stripped trailing punctuation as plain text
      if (cleaned.length < full.length) {
        nodes.push(full.slice(cleaned.length));
      }
    } else if (full.startsWith("**")) {
      // Bold
      nodes.push(<strong key={matchIndex}>{full.slice(2, -2)}</strong>);
    } else if (full.startsWith("*")) {
      // Italic
      nodes.push(<em key={matchIndex}>{full.slice(1, -1)}</em>);
    }

    lastIndex = matchIndex + full.length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/** Parse a markdown string into React elements. */
function parseMarkdown(source: string): ReactNode[] {
  const lines = source.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    // Safe: i is always in bounds due to while condition
    const line = lines[i] as string;

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !(lines[i] as string).trimStart().startsWith("```")
      ) {
        codeLines.push(lines[i] as string);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-lg bg-base-300 p-3 font-mono text-sm"
        >
          <code data-lang={lang || undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Headings: # through ######
    const headingMatch = /^(#{1,6}) (.+)$/.exec(line);
    if (headingMatch) {
      const level = (headingMatch[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2] as string;
      const Tag = `h${level}` as const;
      const sizeClass = (
        {
          1: "text-2xl font-bold",
          2: "text-xl font-bold",
          3: "text-lg font-semibold",
          4: "text-base font-semibold",
          5: "text-sm font-semibold",
          6: "text-sm font-medium text-base-content/70",
        } as const
      )[level];
      elements.push(
        <Tag key={`h-${i}`} className={sizeClass}>
          {parseInline(content)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Unordered list items (-, *, +)
    if (/^[ \t]*[-*+] /.test(line)) {
      const listItems: ReactNode[] = [];
      while (i < lines.length && /^[ \t]*[-*+] /.test(lines[i] as string)) {
        const content = (lines[i] as string).replace(/^[ \t]*[-*+] /, "");
        listItems.push(<li key={`li-${i}`}>{parseInline(content)}</li>);
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-6">
          {listItems}
        </ul>,
      );
      continue;
    }

    // Ordered list items (1. 2. etc.)
    if (/^[ \t]*\d+\. /.test(line)) {
      const listItems: ReactNode[] = [];
      while (i < lines.length && /^[ \t]*\d+\. /.test(lines[i] as string)) {
        const content = (lines[i] as string).replace(/^[ \t]*\d+\. /, "");
        listItems.push(<li key={`oli-${i}`}>{parseInline(content)}</li>);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-6">
          {listItems}
        </ol>,
      );
      continue;
    }

    // Blank line → spacing
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph line — apply inline formatting
    elements.push(<p key={`p-${i}`}>{parseInline(line)}</p>);
    i++;
  }

  return elements;
}

/** Render a markdown string. Falls back to "No content" placeholder when empty. */
export function Markdown({
  content,
  placeholder,
}: {
  content: string | undefined;
  placeholder?: string;
}) {
  if (!content) {
    return (
      <span className="text-base-content/40 italic">
        {placeholder ?? "No content."}
      </span>
    );
  }

  return (
    <div className="prose prose-sm max-w-none space-y-1 [&_code]:text-base-content [&_pre]:my-2">
      {parseMarkdown(content)}
    </div>
  );
}
