import { CHARACTER_LIMIT } from "../constants.js";
import { PerplexityApiError } from "./perplexity-client.js";
import type { PerplexityAnswer } from "../types.js";

/** Standard MCP tool result shape used across every tool in this server. */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Converts any error thrown by the Perplexity client (or anything else) into
 * a well-formed, actionable MCP tool error result instead of letting the
 * process crash or returning an opaque stack trace to the calling agent.
 */
export function toErrorResult(error: unknown): ToolResult {
  if (error instanceof PerplexityApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${error.message}\nGuidance: ${error.guidance}`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Error: Unexpected error occurred: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ],
  };
}

/** Truncates text to CHARACTER_LIMIT, appending a clear notice if cut. */
export function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, truncated: false };
  }
  const cut = text.slice(0, CHARACTER_LIMIT);
  return {
    text:
      cut +
      `\n\n[...truncated: response exceeded ${CHARACTER_LIMIT} characters. ` +
      `Narrow the query or lookback window for a complete answer.]`,
    truncated: true,
  };
}

/** Renders the shared "Sources" section used by every markdown response. */
export function formatCitations(answer: PerplexityAnswer): string {
  if (answer.searchResults.length > 0) {
    return [
      "",
      "**Sources:**",
      ...answer.searchResults.map(
        (r, i) => `${i + 1}. [${r.title}](${r.url})${r.date ? ` — ${r.date}` : ""}`,
      ),
    ].join("\n");
  }
  if (answer.citations.length > 0) {
    return [
      "",
      "**Sources:**",
      ...answer.citations.map((url, i) => `${i + 1}. ${url}`),
    ].join("\n");
  }
  return "";
}
