/**
 * Session E2E: real plugins from Anthropic's official marketplace, installed by path and run end to
 * end. Each scenario asserts what Claude Code documents (code.claude.com/docs/en/…), quoted beside
 * the assertion; a `known` marker names where Localix still differs, one gap per scenario.
 *
 * The plugin trees come from `CC_OFFICIAL_PLUGINS_DIR` (a checkout of
 * anthropics/claude-plugins-official's `plugins/`), copied into the run's root and installed from
 * there. Without it the whole group is left out. A small spy plugin records what a hook received
 * (stdin, environment, working directory), and a realtime socket watches the session the way the
 * app does, for the notices a person sees.
 *
 * ralph-loop's own loop (its Stop hook feeding the prompt back) is not asserted: the hook reads the
 * last assistant text out of Claude Code's internal transcript JSONL, which hooks.md documents only
 * as "Path to conversation JSON" and tells hooks not to parse (use `last_assistant_message`).
 */
import { existsSync } from 'node:fs'

import { CC_OFFICIAL_HOOKIFY_SCENARIOS } from './scenarios-cc-official-hookify.mjs'
import { CC_OFFICIAL_COMMAND_SCENARIOS } from './scenarios-cc-official-commands.mjs'
import { CC_OFFICIAL_AGENT_LOOP_SCENARIOS } from './scenarios-cc-official-agents-loops.mjs'
import { SOURCE } from './scenarios-cc-official-helpers.mjs'

/** Left out unless a checkout of the official plugins is named. */
export const CC_OFFICIAL_SCENARIOS =
  SOURCE && existsSync(SOURCE)
    ? [
        ...CC_OFFICIAL_HOOKIFY_SCENARIOS,
        ...CC_OFFICIAL_COMMAND_SCENARIOS,
        ...CC_OFFICIAL_AGENT_LOOP_SCENARIOS,
      ]
    : []
