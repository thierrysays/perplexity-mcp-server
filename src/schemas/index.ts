import { z } from "zod";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const CompanyNewsInputSchema = z
  .object({
    organization: z
      .string()
      .min(2, "Organization name must be at least 2 characters")
      .max(200)
      .describe("Legal or commercial name of the company to research, e.g. 'Doctolib'."),
    lookback_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90)
      .describe(
        "How far back to look for news, in days (default 90 = 'last 3 months'). " +
          "Mapped internally to Perplexity's nearest recency bucket.",
      ),
    language: z
      .enum(["fr", "en"])
      .default("fr")
      .describe("Language of the synthesized answer."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable."),
  })
  .strict();

export type CompanyNewsInput = z.infer<typeof CompanyNewsInputSchema>;

export const MarketSignalsInputSchema = z
  .object({
    profile: z
      .string()
      .min(3)
      .max(500)
      .describe(
        "The professional profile signals should be relevant to, e.g. " +
          "'CTO groupe / VP Technology / Chief Transformation Officer / Group CIO'.",
      ),
    regions: z
      .array(z.string())
      .min(1)
      .max(10)
      .default(["France", "Europe", "Luxembourg"])
      .describe("Geographic scope for signals."),
    lookback_days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe("How far back to look for signals, in days (default 7 = 'this week')."),
    signal_types: z
      .array(z.string())
      .min(1)
      .max(10)
      .default([
        "M&A",
        "levée de fonds",
        "nomination de dirigeant",
        "restructuration",
      ])
      .describe("Categories of signal to look for."),
    language: z
      .enum(["fr", "en"])
      .default("fr")
      .describe("Language of the synthesized answer."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable."),
  })
  .strict();

export type MarketSignalsInput = z.infer<typeof MarketSignalsInputSchema>;
