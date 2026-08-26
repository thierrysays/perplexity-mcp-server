import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "../constants.js";
import type {
  PerplexityAnswer,
  PerplexityChatCompletionResponse,
} from "../types.js";

/**
 * Thrown for all Perplexity API failures. `guidance` is a short, actionable
 * suggestion that tools surface directly to the calling agent.
 */
export class PerplexityApiError extends Error {
  constructor(
    message: string,
    public readonly guidance: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PerplexityApiError";
  }
}

export interface ChatCompletionParams {
  query: string;
  model: string;
  systemPrompt?: string;
  recencyFilter?: "hour" | "day" | "week" | "month" | "year";
  domainFilter?: string[];
  searchMode?: "web" | "academic" | "sec";
  maxTokens?: number;
  temperature?: number;
  /**
   * When set, asks Perplexity to constrain its `message.content` to valid
   * JSON matching this schema, so callers can `JSON.parse` the answer
   * directly instead of parsing free-form markdown.
   */
  jsonSchema?: Record<string, unknown>;
}

/**
 * Maps an arbitrary lookback window (in days) to the closest
 * search_recency_filter bucket supported by the Perplexity API. Perplexity
 * has no native "quarter" or "90 days" filter, so callers that need e.g. "3
 * derniers mois" pass lookbackDays=90 and get "month" back — the widest
 * native bucket short of "year". Returns undefined for lookbackDays > 365
 * (no recency restriction: let the model use its own relevance judgment).
 */
export function lookbackDaysToRecencyFilter(
  lookbackDays: number,
): ChatCompletionParams["recencyFilter"] | undefined {
  if (lookbackDays <= 1) return "day";
  if (lookbackDays <= 7) return "week";
  if (lookbackDays <= 31) return "month";
  if (lookbackDays <= 365) return "year";
  return undefined;
}

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) {
    throw new PerplexityApiError(
      "PERPLEXITY_API_KEY is not set",
      "Set the PERPLEXITY_API_KEY environment variable on the server process before starting it. " +
        "See .env.example for the expected format.",
    );
  }
  return key;
}

/**
 * Calls the Perplexity chat/completions endpoint and normalizes the
 * response into the shape every tool consumes (answer text + citations +
 * search results), so tool implementations never touch Perplexity's raw
 * response format.
 */
export async function askPerplexity(
  params: ChatCompletionParams,
): Promise<PerplexityAnswer> {
  const apiKey = getApiKey();

  const messages = params.systemPrompt
    ? [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.query },
      ]
    : [{ role: "user", content: params.query }];

  try {
    const response = await axios.post<PerplexityChatCompletionResponse>(
      `${API_BASE_URL}/chat/completions`,
      {
        model: params.model,
        messages,
        ...(params.recencyFilter
          ? { search_recency_filter: params.recencyFilter }
          : {}),
        ...(params.domainFilter && params.domainFilter.length > 0
          ? { search_domain_filter: params.domainFilter }
          : {}),
        ...(params.searchMode ? { search_mode: params.searchMode } : {}),
        ...(params.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { schema: params.jsonSchema },
              },
            }
          : {}),
        max_tokens: params.maxTokens ?? 2000,
        temperature: params.temperature ?? 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      },
    );

    const data = response.data;
    const content = data.choices?.[0]?.message?.content ?? "";

    return {
      answer: content,
      citations: data.citations ?? [],
      searchResults: (data.search_results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        date: r.date ?? null,
      })),
      model: data.model,
      usage: data.usage,
      costUsd: data.cost?.total_cost,
    };
  } catch (error) {
    throw toPerplexityApiError(error);
  }
}

function toPerplexityApiError(error: unknown): PerplexityApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: { message?: string } }>;
    const status = axiosError.response?.status;
    const apiMessage = axiosError.response?.data?.error?.message;

    switch (status) {
      case 401:
        return new PerplexityApiError(
          apiMessage ?? "Invalid Perplexity API key",
          "The PERPLEXITY_API_KEY is missing or invalid. Verify it at " +
            "https://www.perplexity.ai/settings/api and update the server's environment variable.",
          401,
        );
      case 429:
        return new PerplexityApiError(
          apiMessage ?? "Perplexity rate limit exceeded",
          "Too many requests. Wait before retrying, or reduce request frequency / concurrency.",
          429,
        );
      case 400:
        return new PerplexityApiError(
          apiMessage ?? "Invalid request to Perplexity API",
          "Check the query, model name, and filter parameters. " +
            `Details: ${apiMessage ?? "no further detail returned by the API"}.`,
          400,
        );
      default:
        if (axiosError.code === "ECONNABORTED") {
          return new PerplexityApiError(
            "Request to Perplexity timed out",
            "The request took too long (>60s). Try a narrower query or retry.",
          );
        }
        return new PerplexityApiError(
          apiMessage ?? `Perplexity API request failed (status ${status ?? "unknown"})`,
          "Retry the request; if it persists, check https://status.perplexity.ai.",
          status,
        );
    }
  }
  return new PerplexityApiError(
    error instanceof Error ? error.message : String(error),
    "Unexpected error — check server logs for details.",
  );
}
