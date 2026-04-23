/**
 * Boot an in-memory MCP client/server pair for end-to-end tool tests.
 *
 * The server is `buildServer({ apiKey, baseUrl, fetchImpl })` with a mock
 * fetch so upstream Meertrack calls are stubbable. Both ends are linked via
 * `InMemoryTransport.createLinkedPair()` — no network, no process.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/server.js";

export interface McpPair {
  client: Client;
  close(): Promise<void>;
}

export async function createMcpPair(opts: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<McpPair> {
  const server = buildServer({
    apiKey: opts.apiKey ?? "mt_live_test",
    baseUrl: opts.baseUrl ?? "https://api.example/v1",
    fetchImpl: opts.fetchImpl,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
