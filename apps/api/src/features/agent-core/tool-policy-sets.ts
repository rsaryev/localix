/**
 * Tool-name policy kept outside the browser-imported catalog.
 *
 * An `ECONOMY_DISABLED_TOOLS` set used to live here too — the built-ins a session-level
 * "economy mode" stripped. It is gone with that mode: a second, per-session answer to "which
 * tools does this run get" is the exact shape that let a tool be ON in Capabilities and absent
 * from the turn. A lean run is an agent whose rules are lean.
 */
import { TOOL } from './tool-names'

/**
 * Tools the usage garbage collector may never propose disabling, however cold the counters look.
 *
 * This is NOT "the tools the default registry emits" — that set (`createRuntimeToolRegistry()`
 * with no options) also carries `research`, and a user who never does web research
 * should be free to trim it. The line here is narrower and structural: a tool
 * belongs on this list when its absence would leave the agent unable to WORK or unable to
 * RECOVER, so no amount of disuse evidence could justify the suggestion.
 *
 * - `read` / `write` / `edit` / `search` / `bash` — the edit-and-verify loop itself.
 * - `ask` — the way to reach the human. An agent that cannot ask cannot unblock.
 * - `tool_output` — elided and indexed tool results ADVERTISE it by name
 *   (`run-shape.ts` `withElisionRecovery` adds it back to any custom role for exactly this
 *   reason: "a pointer to a hidden tool is a dead end"). Disabling it turns every recovery
 *   pointer in a long session into a wasted turn.
 * - `set_topic` — the chat's context-saving topic boundary.
 *
 */
export const TOOL_GC_PROTECTED: readonly string[] = [
  TOOL.ask,
  TOOL.bash,
  TOOL.read,
  TOOL.search,
  TOOL.write,
  TOOL.edit,
  TOOL.tool_output,
  TOOL.set_topic,
]
