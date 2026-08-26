#!/usr/bin/env node
/**
 * MCP server for structured competitive/market-intelligence veille workflows
 * on top of the Perplexity Sonar API.
 *
 * Exposes two workflow tools (perplexity_company_news, perplexity_market_signals)
 * that fix prompt structure and constrain output shape server-side. This is
 * deliberately narrow: for generic ad hoc search, use Perplexity's own
 * official remote MCP server (https://api.perplexity.ai/mcp,
 * github.com/perplexityai/modelcontextprotocol) instead of duplicating it
 * here.
 *
 * Supports two transports, chosen via the TRANSPORT env var:
 *   - "stdio" (default): local use, e.g. registered in Claude Desktop's MCP
 *     config. The PERPLEXITY_API_KEY only needs to exist on the machine
 *     running this process.
 *   - "http": remote deployment. Run this on any Node-capable host (a small
 *     VPS, Render, Railway, Fly.io, etc.) with PERPLEXITY_API_KEY set as a
 *     platform secret, then register the resulting https://.../mcp URL as a
 *     remote MCP connector. This is what makes the server reachable from a
 *     cloud-scheduled session that has no access to the local machine or its
 *     device bridge — the credential lives on the server, not in a local
 *     file read through a bridge tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { registerCompanyNewsTool } from "./tools/company-news.js";
import { registerMarketSignalsTool } from "./tools/market-signals.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "perplexity-mcp-server",
    version: "1.0.0",
  });

  registerCompanyNewsTool(server);
  registerMarketSignalsTool(server);

  return server;
}

function requireApiKey(): void {
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error(
      "ERROR: PERPLEXITY_API_KEY environment variable is required. " +
        "Copy .env.example to .env and set it, or export it in your shell/hosting platform.",
    );
    process.exit(1);
  }
}

async function runStdio(): Promise<void> {
  requireApiKey();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must never write to stdout — it would corrupt the protocol
  // stream — so all logging goes to stderr.
  console.error("perplexity-mcp-server running via stdio");
}

async function runHTTP(): Promise<void> {
  requireApiKey();
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    // A fresh server + transport per request keeps this stateless: no
    // shared session state between requests, which is simpler to scale and
    // matches how a scheduled Cowork/Claude session will call this server
    // (short-lived, independent requests) rather than a long-lived client
    // session.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", server: "perplexity-mcp-server" });
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`perplexity-mcp-server running on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
