#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { HarborService } from "./services/harbor.service.js";
import { TOOL_DEFINITIONS } from "./definitions/tool.definitions.js";
import { config } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express from "express";
import { timingSafeEqual } from "node:crypto";

// Load environment variables
config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .env("HARBOR")
  .options({
    url: {
      type: "string",
      description: "Harbor API URL (the remote Harbor server mcp-harbor connects to)",
      demandOption: true,
    },
    username: {
      type: "string",
      description: "Harbor username",
      demandOption: true,
      default: "admin",
    },
    password: {
      type: "string",
      description: "Harbor password",
      demandOption: true,
    },
    insecureTls: {
      type: "boolean",
      description:
        "Disable TLS certificate verification when connecting to the Harbor URL over HTTPS. Only enable this for trusted internal networks using a self-signed certificate; has no effect if --url is http://.",
      default: false,
    },
    debug: {
      type: "boolean",
      description: "Enable debug mode",
      default: false,
    },
    sse: {
      type: "boolean",
      description: "Enable SSE transport",
      default: false,
    },
    port: {
      type: "number",
      description: "Port for the local SSE server to listen on",
      default: 3000,
    },
    sseHost: {
      type: "string",
      description:
        "Host/interface the local SSE server binds to (this machine, not the Harbor server). Keep 127.0.0.1 unless a trusted firewall/reverse proxy restricts who can reach this port.",
      default: "127.0.0.1",
    },
    sseAuthToken: {
      type: "string",
      description:
        "Bearer token required to authenticate SSE connections to this MCP server (required in practice whenever --sse-host is not 127.0.0.1)",
    },
  })
  .help()
  .parseSync(); // Use parseSync instead of argv

if (argv.insecureTls) {
  console.warn(
    "[MCP Server] WARNING: TLS certificate verification is disabled (--insecure-tls). " +
      "Only use this for trusted internal networks with self-signed certificates."
  );
  // hapic/undici honor this Node-wide flag; there is no per-client TLS
  // override exposed by the Harbor client, so this is opt-in and scoped
  // to when the operator explicitly requests it.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Initialize HarborService with command line arguments
const harborService = new HarborService(argv.url, {
  username: argv.username,
  password: argv.password,
});

const createServer: () => Promise<Server> = async (): Promise<Server> => {
  interface ToolDefinition {
    description: string;
    inputSchema: Record<string, unknown>;
  }

  interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }

  // Initialize the MCP server
  const server: Server = new Server(
    {
      name: "mcp-harbor",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: TOOL_DEFINITIONS as Record<string, ToolDefinition>,
      },
    }
  );

  server.onerror = (error: Error): void => {
    console.error("[MCP Error]", error);
    console.error("[MCP Error Stack]", error.stack);

    if (error.cause) {
      console.error("[MCP Error Cause]", error.cause);
    }
  };

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<{
      tools: Tool[];
    }> => ({
      tools: Object.entries(TOOL_DEFINITIONS).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema,
      })),
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      try {
        const args: Record<string, unknown> = request.params.arguments || {};
        return await harborService.handleToolRequest(request.params.name, args);
      } catch (error: unknown) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : "Unknown error occurred"
        );
      }
    }
  );

  return server;
};

const server = await createServer();

// Check if SSE transport is enabled
if (argv.sse) {
  console.info("[MCP Server] Using SSE transport");
  const app = express();

  const transports = new Map<string, SSEServerTransport>();

  const isAuthorized = (req: express.Request): boolean => {
    if (!argv.sseAuthToken) return true;

    const header = req.headers.authorization || "";
    const expected = `Bearer ${argv.sseAuthToken}`;
    const provided = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);

    return (
      provided.length === expectedBuf.length &&
      timingSafeEqual(provided, expectedBuf)
    );
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!isAuthorized(req)) {
      res.status(401).send("Unauthorized");
      return;
    }
    next();
  };

  app.get("/sse", requireAuth, async (req, res) => {
    console.log("[MCP Server] SSE connection established");

    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    transport.onclose = (): void => {
      transports.delete(transport.sessionId);
    };

    await server.connect(transport);
  });

  app.post("/messages", requireAuth, (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("No SSE connection established for this session");
      return;
    }
    transport.handlePostMessage(req, res);
  });

  app.listen(argv.port, argv.sseHost, () => {
    console.info(
      `[MCP Server] SSE server running on ${argv.sseHost}:${argv.port}`
    );
  });
} else {
  await server.connect(new StdioServerTransport());
}
