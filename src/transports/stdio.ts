import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, type BuildServerOptions } from "../server.js";
import { logger } from "../logger.js";
import { VERSION } from "../version.js";

/**
 * stdio transport: read JSON-RPC frames from process.stdin, write responses to
 * process.stdout. stdout is a protocol channel — every diagnostic must go to
 * stderr so we don't corrupt the MCP framing. The logger writes single-line
 * JSON to stderr for parity with the HTTP transport, with the same redaction.
 *
 * Owns the process lifetime: returns when the transport closes (client
 * disconnected stdin) or a fatal signal fires.
 */
export async function runStdio(opts: BuildServerOptions): Promise<void> {
  const server = buildServer(opts);
  const transport = new StdioServerTransport();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.log({ event: "stdio_shutdown", signal });
    try {
      await server.close();
    } catch (err) {
      logger.log({
        event: "stdio_shutdown_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);
  logger.log({ event: "stdio_ready", version: VERSION });
}
