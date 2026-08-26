import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { askPerplexity } from "../services/perplexity-client.js";
import { formatCitations, toErrorResult, truncate } from "../services/tool-helpers.js";
import {
  PerplexitySearchInputSchema,
  ResponseFormat,
  type PerplexitySearchInput,
} from "../schemas/index.js";

/**
 * Registers the generic, full-coverage Perplexity search tool. Use this for
 * any one-off query that doesn't fit the company-news or market-signals
 * workflow tools — it exposes the full parameter surface of the underlying
 * Perplexity chat/completions API (model choice, recency filter, domain
 * filter, search mode).
 */
export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    "perplexity_search",
    {
      title: "Perplexity Search",
      description: `Ask Perplexity's Sonar models a question and get a cited, web-grounded answer.

This is the general-purpose tool for this server: use it for any research question that isn't
specifically about a company's recent news (use perplexity_company_news) or sector-wide market
signals (use perplexity_market_signals).

Args:
  - query (string): The question to ask. Must be self-contained — no conversation memory.
  - model ('sonar' | 'sonar-pro' | 'sonar-reasoning-pro'): default 'sonar'.
  - recency_filter ('hour'|'day'|'week'|'month'|'year', optional): restrict sources by age.
  - domain_filter (string[], optional, max 10): restrict sources to these domains.
  - search_mode ('web'|'academic'|'sec'): default 'web'.
  - response_format ('markdown'|'json'): default 'markdown'.

Returns:
  Markdown: the synthesized answer followed by a numbered "Sources" list of URLs.
  JSON: { "answer": string, "citations": string[], "search_results": [{title,url,snippet,date}],
          "model": string, "usage": {...} }

Examples:
  - Use when: "What happened at Atos' board this month?" -> query="...", recency_filter="month"
  - Use when: "Summarize academic research on X" -> search_mode="academic"
  - Don't use when: you need a structured company-news brief with named sections
    (gouvernance, dirigeants, finances) -> use perplexity_company_news instead.

Error Handling:
  - Returns "Error: ... Invalid Perplexity API key" if PERPLEXITY_API_KEY is missing/invalid (401).
  - Returns "Error: ... rate limit exceeded" if too many requests (429).`,
      inputSchema: PerplexitySearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: PerplexitySearchInput) => {
      try {
        const result = await askPerplexity({
          query: params.query,
          model: params.model,
          recencyFilter: params.recency_filter,
          domainFilter: params.domain_filter,
          searchMode: params.search_mode,
        });

        const structured = {
          answer: result.answer,
          citations: result.citations,
          search_results: result.searchResults,
          model: result.model,
          usage: result.usage,
        };

        if (params.response_format === ResponseFormat.JSON) {
          const { text } = truncate(JSON.stringify(structured, null, 2));
          return { content: [{ type: "text", text }], structuredContent: structured };
        }

        const markdown = result.answer + formatCitations(result);
        const { text } = truncate(markdown);
        return { content: [{ type: "text", text }], structuredContent: structured };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
