import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NamelixClient } from "./namelix.ts";
import { registerTools } from "./tools.ts";

export function createServer(): McpServer {
  const maxRetries = parseIntEnv("NAMELIX_MAX_RETRIES");
  const retryDelayMs = parseIntEnv("NAMELIX_RETRY_DELAY_MS");
  const userAgent = process.env.NAMELIX_USER_AGENT;

  const client = new NamelixClient({
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    ...(userAgent ? { userAgent } : {}),
  });

  const server = new McpServer(
    {
      name: "namelix",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Generate brand names via namelix.com. Use generate_names first, then refine_names with the full list of names already shown.",
    },
  );

  registerTools(server, client);

  return server;
}

function parseIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}
