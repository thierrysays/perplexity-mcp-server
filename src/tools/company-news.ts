import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  askPerplexity,
  lookbackDaysToRecencyFilter,
} from "../services/perplexity-client.js";
import { formatCitations, toErrorResult, truncate } from "../services/tool-helpers.js";
import {
  CompanyNewsInputSchema,
  ResponseFormat,
  type CompanyNewsInput,
} from "../schemas/index.js";

const SYSTEM_PROMPT_FR = `Tu es un analyste de veille entreprise. Réponds en français, de façon factuelle et
structurée, en citant systématiquement tes sources. Si une catégorie n'a rien de notable à signaler
sur la période, écris explicitement "Rien à signaler" pour cette catégorie plutôt que de l'omettre.`;

const SYSTEM_PROMPT_EN = `You are a corporate intelligence analyst. Answer factually and in a
structured way, always citing your sources. If a category has nothing notable to report for the
period, explicitly write "Nothing to report" for that category rather than omitting it.`;

function buildQuery(input: CompanyNewsInput): string {
  const months = Math.round(input.lookback_days / 30);
  const periodFr = months <= 1 ? "le dernier mois" : `les ${months} derniers mois`;
  const periodEn = months <= 1 ? "the last month" : `the last ${months} months`;

  if (input.language === "fr") {
    return `Actualité récente (${periodFr}) de ${input.organization} : gouvernance, dirigeants, ` +
      `événements stratégiques, situation financière, mouvements RH de direction. ` +
      `Structure ta réponse avec ces cinq intitulés exacts en gras : **Gouvernance**, ` +
      `**Dirigeants**, **Événements stratégiques**, **Situation financière**, ` +
      `**Mouvements RH de direction**. Cite tes sources avec dates précises.`;
  }
  return `Recent news (${periodEn}) about ${input.organization}: governance, executives, ` +
    `strategic events, financial situation, senior HR moves. Structure your answer with these ` +
    `five exact bold headings: **Governance**, **Executives**, **Strategic events**, ` +
    `**Financial situation**, **Senior HR moves**. Cite your sources with precise dates.`;
}

/**
 * Registers the company-news workflow tool: a structured replacement for the
 * ad hoc "actualité récente de [organisation]..." prompt used previously,
 * with a fixed section structure and a lookback window instead of free text.
 */
export function registerCompanyNewsTool(server: McpServer): void {
  server.registerTool(
    "perplexity_company_news",
    {
      title: "Perplexity Company News Brief",
      description: `Get a structured, cited news brief on one company: governance, executives,
strategic events, financial situation, and senior HR moves.

This is a workflow tool built on top of perplexity_search: it fixes the prompt structure and
section headings so every call returns a comparable, five-section brief, and maps a plain
lookback_days number to Perplexity's recency buckets (there is no native "3 months" filter, so
lookback_days=90 is mapped to the nearest bucket, 'month').

Args:
  - organization (string): Company name, e.g. "Doctolib".
  - lookback_days (number, 1-365, default 90): how far back to search ("90" = "last 3 months").
  - language ('fr'|'en'): default 'fr'.
  - response_format ('markdown'|'json'): default 'markdown'.

Returns:
  Markdown: five headed sections (Gouvernance/Governance, Dirigeants/Executives, Événements
  stratégiques/Strategic events, Situation financière/Financial situation, Mouvements RH/Senior HR
  moves), each stating "Rien à signaler"/"Nothing to report" if empty, followed by numbered Sources.
  JSON: { "answer": string (same structured text), "citations": string[],
          "search_results": [...], "organization": string, "lookback_days": number }

Examples:
  - Use when: "Quelle est l'actualité récente de Nexans ?" -> organization="Nexans"
  - Use when: weekly veille loop over a list of target companies -> call once per company
  - Don't use when: you need sector-wide signals across many companies -> use
    perplexity_market_signals instead.

Error Handling:
  - Returns "Error: ... Invalid Perplexity API key" if PERPLEXITY_API_KEY is missing/invalid (401).
  - Returns "Error: ... rate limit exceeded" if too many requests (429).`,
      inputSchema: CompanyNewsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: CompanyNewsInput) => {
      try {
        const result = await askPerplexity({
          query: buildQuery(params),
          model: "sonar-pro",
          systemPrompt: params.language === "fr" ? SYSTEM_PROMPT_FR : SYSTEM_PROMPT_EN,
          recencyFilter: lookbackDaysToRecencyFilter(params.lookback_days),
        });

        const structured = {
          answer: result.answer,
          citations: result.citations,
          search_results: result.searchResults,
          organization: params.organization,
          lookback_days: params.lookback_days,
        };

        if (params.response_format === ResponseFormat.JSON) {
          const { text } = truncate(JSON.stringify(structured, null, 2));
          return { content: [{ type: "text", text }], structuredContent: structured };
        }

        const markdown =
          `# ${params.organization}\n\n` + result.answer + formatCitations(result);
        const { text } = truncate(markdown);
        return { content: [{ type: "text", text }], structuredContent: structured };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
