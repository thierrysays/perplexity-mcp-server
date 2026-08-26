import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { askPerplexity, lookbackDaysToRecencyFilter } from "../services/perplexity-client.js";
import { toErrorResult, truncate } from "../services/tool-helpers.js";
import {
  MarketSignalsInputSchema,
  ResponseFormat,
  type MarketSignalsInput,
} from "../schemas/index.js";
import type { MarketSignal } from "../types.js";

const SIGNALS_JSON_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short headline for the signal" },
          type: {
            type: "string",
            description:
              "One of the requested signal_types this item belongs to (or 'Autre' if none fit)",
          },
          date: {
            type: ["string", "null"],
            description: "ISO date (YYYY-MM-DD) the event occurred or was reported, if known",
          },
          source_url: { type: ["string", "null"], description: "URL of the primary source" },
          summary: { type: "string", description: "One to three sentence summary" },
        },
        required: ["title", "type", "summary"],
      },
    },
  },
  required: ["signals"],
} as const;

function buildQuery(input: MarketSignalsInput): string {
  const regions = input.regions.join(", ");
  const types = input.signal_types.join(", ");
  const days = input.lookback_days;
  const periodFr = days <= 7 ? "cette semaine (7 derniers jours)" : `les ${days} derniers jours`;
  const periodEn = days <= 7 ? "this week (last 7 days)" : `the last ${days} days`;

  if (input.language === "fr") {
    return `${periodFr[0].toUpperCase()}${periodFr.slice(1)} : ${types} en ${regions} ` +
      `pertinents pour un profil ${input.profile}. ` +
      `Ne retiens que des événements datés précisément dans cette période, avec leur source. ` +
      `Si tu ne trouves aucun signal fiable et daté dans la période, renvoie un tableau "signals" vide ` +
      `plutôt que d'inventer ou d'inclure des événements plus anciens.`;
  }
  return `${periodEn[0].toUpperCase()}${periodEn.slice(1)}: ${types} in ${regions} ` +
    `relevant to a ${input.profile} profile. ` +
    `Only include events precisely dated within this period, with their source. ` +
    `If you find no reliable, dated signal in the period, return an empty "signals" array ` +
    `rather than inventing or including older events.`;
}

function toMarkdown(signals: MarketSignal[], input: MarketSignalsInput): string {
  if (signals.length === 0) {
    return input.language === "fr"
      ? `Aucun signal daté et fiable trouvé sur les ${input.lookback_days} derniers jours pour ce profil.`
      : `No reliably dated signal found in the last ${input.lookback_days} days for this profile.`;
  }
  return signals
    .map((s, i) => {
      const lines = [
        `## ${i + 1}. ${s.title}`,
        `- **Type**: ${s.type}`,
        `- **Date**: ${s.date ?? "non précisée"}`,
        s.source_url ? `- **Source**: ${s.source_url}` : null,
        `- ${s.summary}`,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Registers the market-signals workflow tool: replaces the previous ad hoc
 * "cette semaine... cite tes dates" free-text prompt with a JSON-schema
 * constrained Perplexity call, so the server returns a genuinely structured
 * list of signals (title/type/date/source_url/summary) instead of markdown
 * that a downstream agent had to re-parse.
 */
export function registerMarketSignalsTool(server: McpServer): void {
  server.registerTool(
    "perplexity_market_signals",
    {
      title: "Perplexity Market Signals",
      description: `Find recent, dated market signals (M&A, funding rounds, executive appointments,
restructurings, etc.) relevant to a given professional profile and region, as a structured list.

Unlike perplexity_search, this tool constrains Perplexity's response to a JSON schema server-side,
so the result is a real array of discrete signals — not markdown you have to re-parse. It returns
an empty list rather than fabricated signals when nothing dated and reliable is found; that empty
list is itself a meaningful, actionable result (it means the sweep ran and found nothing this
period), not a failure.

Args:
  - profile (string): Target professional profile, e.g. "CTO groupe / VP Technology / Chief
    Transformation Officer / Group CIO".
  - regions (string[], default ["France","Europe","Luxembourg"]): geographic scope.
  - lookback_days (number, 1-30, default 7): how far back to search.
  - signal_types (string[], default M&A/levée de fonds/nomination/restructuration): categories.
  - language ('fr'|'en'): default 'fr'.
  - response_format ('markdown'|'json'): default 'markdown'.

Returns:
  Markdown: one numbered section per signal (title, type, date, source, summary), or an explicit
  "no signal found" statement if the array is empty.
  JSON: { "signals": [{title,type,date,source_url,summary}], "count": number,
          "lookback_days": number, "regions": string[] }

Examples:
  - Use when: weekly sector-wide sweep independent of any specific tracked company
  - Don't use when: you already know the company and want its own news -> use
    perplexity_company_news instead.

Error Handling:
  - Returns "Error: ... Invalid Perplexity API key" if PERPLEXITY_API_KEY is missing/invalid (401).
  - Returns "Error: ... rate limit exceeded" if too many requests (429).
  - If Perplexity returns non-JSON content despite the schema constraint, returns
    "Error: could not parse signals JSON" with the raw answer included so nothing is silently lost.`,
      inputSchema: MarketSignalsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MarketSignalsInput) => {
      try {
        const result = await askPerplexity({
          query: buildQuery(params),
          model: "sonar-pro",
          recencyFilter: lookbackDaysToRecencyFilter(params.lookback_days),
          jsonSchema: SIGNALS_JSON_SCHEMA,
        });

        let signals: MarketSignal[];
        try {
          const parsed = JSON.parse(result.answer) as { signals: MarketSignal[] };
          signals = parsed.signals ?? [];
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Error: could not parse signals JSON from Perplexity's response. " +
                  "Raw answer below — nothing was silently dropped:\n\n" +
                  result.answer,
              },
            ],
          };
        }

        const structured = {
          signals,
          count: signals.length,
          lookback_days: params.lookback_days,
          regions: params.regions,
        };

        if (params.response_format === ResponseFormat.JSON) {
          const { text } = truncate(JSON.stringify(structured, null, 2));
          return { content: [{ type: "text", text }], structuredContent: structured };
        }

        const { text } = truncate(toMarkdown(signals, params));
        return { content: [{ type: "text", text }], structuredContent: structured };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
