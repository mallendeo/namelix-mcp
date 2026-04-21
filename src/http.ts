#!/usr/bin/env bun
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.ts";

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

const PORT = Number(process.env.PORT) || 3000;

function jsonError(
  code: number,
  message: string,
  id: string | number | null = null,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export default {
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    const accept = req.headers.get("accept") ?? "";
    if (!accept.includes("text/event-stream")) {
      const newHeaders = new Headers(req.headers);
      newHeaders.set("accept", "application/json, text/event-stream");
      req = new Request(req.url, {
        method: req.method,
        headers: newHeaders,
        body: req.body,
        duplex: "half",
      });
    }

    if (req.method === "POST") {
      const sessionId = req.headers.get("mcp-session-id");

      let transport: WebStandardStreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else {
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        const server = createServer();
        await server.connect(transport);
      }

      return transport.handleRequest(req);
    }

    if (req.method === "DELETE") {
      const sessionId = req.headers.get("mcp-session-id");
      if (!sessionId || !sessions.has(sessionId)) {
        return jsonError(-32000, "Invalid session");
      }

      const transport = sessions.get(sessionId)!;
      await transport.close();
      sessions.delete(sessionId);

      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

console.log(`namelix-mcp running on http://localhost:${PORT}/mcp`);
