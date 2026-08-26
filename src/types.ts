// Shared TypeScript interfaces for the Perplexity MCP server.

export interface PerplexitySearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string | null;
}

export interface PerplexityUsage {
  total_tokens?: number;
  search_context_size?: string;
  num_search_queries?: number;
}

export interface PerplexityCost {
  total_cost?: number;
}

export interface PerplexityChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  citations?: string[];
  search_results?: PerplexitySearchResult[];
  usage?: PerplexityUsage;
  cost?: PerplexityCost;
}

// Normalized shape returned by the internal client to every tool, so tools
// never touch the raw Perplexity response format directly.
export interface PerplexityAnswer {
  answer: string;
  citations: string[];
  searchResults: PerplexitySearchResult[];
  model: string;
  usage?: PerplexityUsage;
  costUsd?: number;
}

export interface MarketSignal {
  title: string;
  type: string;
  date: string | null;
  source_url: string | null;
  summary: string;
}
