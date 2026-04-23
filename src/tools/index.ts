import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeertrackClient } from "../client.js";
import { registerWhoami, WHOAMI_NAME } from "./whoami.js";
import { registerListCompetitors, LIST_COMPETITORS_NAME } from "./list_competitors.js";
import { registerGetCompetitor, GET_COMPETITOR_NAME } from "./get_competitor.js";
import { registerListActivities, LIST_ACTIVITIES_NAME } from "./list_activities.js";
import { registerGetActivityItem, GET_ACTIVITY_ITEM_NAME } from "./get_activity_item.js";
import { registerListDigests, LIST_DIGESTS_NAME } from "./list_digests.js";
import { registerListLatestDigests, LIST_LATEST_DIGESTS_NAME } from "./list_latest_digests.js";
import { registerGetDigest, GET_DIGEST_NAME } from "./get_digest.js";

/**
 * Register all 8 tools on `server`, each closing over a shared `client`.
 * Order is cosmetic — `tools/list` returns tools in registration order, and
 * a workspace → competitors → activity → digests ordering reads well when
 * an LLM scans the list.
 */
export function registerAllTools(server: McpServer, client: MeertrackClient): void {
  registerWhoami(server, client);
  registerListCompetitors(server, client);
  registerGetCompetitor(server, client);
  registerListActivities(server, client);
  registerGetActivityItem(server, client);
  registerListDigests(server, client);
  registerListLatestDigests(server, client);
  registerGetDigest(server, client);
}

export const TOOL_NAMES = [
  WHOAMI_NAME,
  LIST_COMPETITORS_NAME,
  GET_COMPETITOR_NAME,
  LIST_ACTIVITIES_NAME,
  GET_ACTIVITY_ITEM_NAME,
  LIST_DIGESTS_NAME,
  LIST_LATEST_DIGESTS_NAME,
  GET_DIGEST_NAME,
] as const;

export {
  WHOAMI_NAME,
  LIST_COMPETITORS_NAME,
  GET_COMPETITOR_NAME,
  LIST_ACTIVITIES_NAME,
  GET_ACTIVITY_ITEM_NAME,
  LIST_DIGESTS_NAME,
  LIST_LATEST_DIGESTS_NAME,
  GET_DIGEST_NAME,
};
