# perplexity-mcp-server

MCP server for structured competitive/market-intelligence veille workflows on top of the
Perplexity Sonar API.

**Correction (2026-08-26):** an earlier version of this README claimed no native Perplexity MCP
connector existed anywhere. That was wrong — Perplexity publishes an official MCP server
([github.com/perplexityai/modelcontextprotocol](https://github.com/perplexityai/modelcontextprotocol)),
including a Perplexity-hosted remote endpoint at `https://api.perplexity.ai/mcp` that's reachable
from a cloud-scheduled session with zero self-hosting. If you just need generic ad hoc Sonar
search, register that instead of building or running anything here.

What the official server doesn't give you is a *structured, comparable* weekly veille output: it
exposes generic search/reasoning (Agent API, Search API), not a fixed-section company brief or a
JSON-schema-constrained signal sweep. That's this server's actual reason to exist — it's a thin,
narrow layer of two workflow tools, not a replacement for Perplexity's own MCP server.

Deploy this once (see "Remote deployment" below) with `PERPLEXITY_API_KEY` set as a platform
secret, and any MCP client — including a cloud-scheduled Cowork/Claude session — can call it over
HTTP without ever touching the local machine or a device bridge. Register it *alongside*
Perplexity's official server, not instead of it.

## Tools

- **`perplexity_company_news`** — structured company news brief (governance, executives, strategic
  events, financial situation, senior HR moves), fixed section headings, `lookback_days` instead of
  free-text date ranges. Output language is `fr` (default) or `en` via the `language` parameter —
  headings switch accordingly (e.g. Gouvernance/Governance, Dirigeants/Executives).
- **`perplexity_market_signals`** — sector-wide signal sweep (M&A, funding, appointments,
  restructurings) constrained to a JSON schema server-side, so the result is a real array of
  discrete signals, not markdown to re-parse. Returns an empty array (not an error) when nothing
  dated and reliable is found for the period — that's a meaningful result, not a failure.

Both tools support `response_format: "markdown" | "json"` and return citations/sources. For
general-purpose search, use Perplexity's official MCP server instead — see the correction above.

## Setup

```bash
npm install
cp .env.example .env   # then set PERPLEXITY_API_KEY
npm run build
```

## Local use (stdio) — quick start, does NOT fix the cloud-scheduling problem

Good for testing, or for any workflow that already runs on your own machine. Register it in your
MCP client's config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "node",
      "args": ["/absolute/path/to/perplexity-mcp-server/dist/index.js"],
      "env": { "PERPLEXITY_API_KEY": "pplx-..." }
    }
  }
}
```

This still ties availability to that machine being on — it does not solve the original problem of a
cloud-scheduled task needing the key. For that, use the HTTP deployment below.

## Remote deployment (streamable HTTP) — the actual fix for cloud-scheduled tasks

Run the same code with `TRANSPORT=http`, on any Node-capable host (a small VPS, Render, Railway,
Fly.io, a container on any cloud provider). The only requirements are: Node 18+, the ability to set
an environment variable secret, and a public HTTPS URL.

```bash
PERPLEXITY_API_KEY=pplx-... TRANSPORT=http PORT=3000 npm start
```

The server exposes:
- `POST /mcp` — the MCP endpoint (streamable HTTP, stateless JSON — a fresh server+transport per
  request, so nothing leaks between calls and it scales horizontally without shared state)
- `GET /health` — plain liveness check for your hosting platform's health probe

Once deployed behind HTTPS (`https://your-host/mcp`), register that URL as a remote MCP connector
in the workspace so the Perplexity-dependent scheduled task can reach it directly, with the key
living server-side — the same operational model Pappers already uses (native connector, no local
secret in the credential path).

## What has been verified in this build

- `npm run build` compiles cleanly (strict TypeScript, no `any`).
- Both transports start without crashing (stdio and HTTP).
- `GET /health` responds correctly.
- Full MCP handshake (`initialize`, `tools/list`) returns both tools with correct JSON schemas,
  descriptions, and annotations.
- `tools/call` with an invalid API key returns a clean, actionable `isError: true` result (401
  guidance pointing at the Perplexity dashboard) — the server does not crash and stays responsive
  afterward.

## What has NOT been verified yet

No real `PERPLEXITY_API_KEY` was available in the build environment, so an actual successful
Sonar call — real answer content, real citations, the `market_signals` JSON-schema-constrained
response actually parsing as valid JSON — has not been exercised end-to-end. Before relying on this
in the production veille routine, run each of the two tools once with a real key (locally via
stdio is enough for this check) and confirm the output matches the shapes documented above.

## Cost note

`perplexity_company_news` and `perplexity_market_signals` both default to the `sonar-pro` model
(deeper search, more sources, higher cost per call than `sonar`) because the veille use case
prioritizes completeness and citation quality over latency/cost — this is the deliberate default
for both of this server's tools, confirmed 2026-08-26. There is no `perplexity_search` tool here to
opt into a cheaper model for one-off queries; use Perplexity's official MCP server for that (see
the correction at the top of this file). Review Perplexity's current per-model pricing before
running this at the weekly-routine scale
across dozens of companies — a full run enriches on the order of 50-90 companies plus one
market-signals sweep, so the marginal cost of `sonar-pro` vs `sonar` compounds quickly.
