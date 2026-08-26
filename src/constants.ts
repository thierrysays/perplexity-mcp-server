// Shared constants for the Perplexity MCP server.

export const API_BASE_URL = "https://api.perplexity.ai";

// Maximum characters returned in a single tool response before truncation.
export const CHARACTER_LIMIT = 25000;

// Perplexity models exposed through this server.
export const MODELS = ["sonar", "sonar-pro", "sonar-reasoning-pro"] as const;

// Perplexity's search_recency_filter only accepts these buckets — there is no
// native "quarter" or "90 days" option, so callers pass lookback_days and the
// server maps it to the closest bucket (see services/perplexity-client.ts).
export const RECENCY_FILTERS = ["hour", "day", "week", "month", "year"] as const;

export const SEARCH_MODES = ["web", "academic", "sec"] as const;
