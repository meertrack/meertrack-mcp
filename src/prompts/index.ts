import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWeeklyRecap, WEEKLY_RECAP_NAME } from "./weekly_recap.js";
import {
  registerCompetitorDeepDive,
  COMPETITOR_DEEP_DIVE_NAME,
} from "./competitor_deep_dive.js";
import { registerWhatsNew, WHATS_NEW_NAME } from "./whats_new.js";

/**
 * Register all 3 prompts on `server`. Prompts surface as slash-commands in
 * MCP-aware clients (Claude Desktop, Cursor, …) and chain the 8 tools into
 * complete workflows without requiring the user to specify the orchestration.
 */
export function registerAllPrompts(server: McpServer): void {
  registerWeeklyRecap(server);
  registerCompetitorDeepDive(server);
  registerWhatsNew(server);
}

export const PROMPT_NAMES = [
  WEEKLY_RECAP_NAME,
  COMPETITOR_DEEP_DIVE_NAME,
  WHATS_NEW_NAME,
] as const;

export { WEEKLY_RECAP_NAME, COMPETITOR_DEEP_DIVE_NAME, WHATS_NEW_NAME };
