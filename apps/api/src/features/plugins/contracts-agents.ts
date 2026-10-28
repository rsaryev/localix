import { z } from 'zod'
import { isValidCcAgentName } from './agent-names'

/**
 * A custom worker ROLE a plugin contributes — the same thing a registry agent is, declared in a
 * manifest instead of a file. Shape mirrors the dispatchable fields (name/description/prompt/
 * tools) a forked run takes, so an enabled plugin agent rides the existing dispatch. Selected as
 * `<plugin>:<name>` (a skill's `agent:`). Pure manifest data.
 */
export const pluginAgentSchema = z.object({
  // Accepts a namespaced `foo:bar` name (nested `agents/foo/bar.md`); a plain name is
  // the single-segment case. Claude Code's name rules apply (`agent-names.ts`). Assignee
  // resolution splits on the FIRST `:` so `<plugin>:foo:bar` still routes correctly.
  name: z
    .string()
    .max(256)
    .refine((name) => isValidCcAgentName(name, { namespaced: true })),
  label: z.string().max(60).optional(),
  description: z.string().default(''),
  /** The worker identity/system prompt for this role. */
  prompt: z.string().min(1),
  /** Tool allowlist (engine tool names). Omit to inherit the generic worker surface. */
  tools: z.array(z.string()).optional(),
  /**
   * CC `disallowedTools` — engine tool names removed from the worker's surface.
   * Applied when the agent is dispatched as a delegated task run or sub-agent via `Agent`.
   */
  disallowedTools: z.array(z.string()).optional(),
  /**
   * The agent types `tools: Agent(worker, researcher)` lets the agent delegate to when it runs as
   * the main thread (sub-agents.md: an allowlist; a bare `Agent` allows every type). Absent means
   * no restriction.
   */
  agentTypes: z.array(z.string()).optional(),
  /**
   * CC `skills` — skill names to preload into the agent's context when it runs.
   * The agent sees these skills' full content, not just their descriptions.
   * Comma/space-separated string or YAML inline array.
   * At dispatch time these are set on the worker session as `pinnedSkills` so the
   * skill tool and prompt-context include them in the worker's context window.
   */
  pinnedSkills: z.array(z.string()).optional(),
  /**
   * CC `maxTurns` — max agentic turns (tool batches) before the sub-agent stops.
   * ENFORCED: the delegate runtime caps the child run's `n` (turn limit) at this.
   */
  maxTurns: z.number().int().positive().optional(),
  /**
   * CC `background` — an `Agent` start as this agent never holds the call for its report, even
   * with `wait: true` (`agent-core/tools/agent/agent-type.ts`).
   */
  background: z.boolean().optional(),
  /**
   * CC `memory` — a persistent-memory scope: a run as this agent gets its folder's `MEMORY.md`
   * and the file tools to keep it (`chat/runtime/run/subagent-file-options.ts`).
   */
  memory: z.enum(['user', 'project', 'local']).optional(),
  /** CC `autoCompactWindow` — the child's context window for compaction, 100000–1000000 tokens. */
  autoCompactWindow: z.number().int().min(100_000).max(1_000_000).optional(),
  /**
   * The agent asked to run in a directory of its own: an `Agent` start as this agent works in a
   * fresh git worktree of the chat's repository, kept for the child's life.
   *
   * Claude Code spells this `worktree` in the file; `discovery-cc-files.ts` translates it at the
   * boundary, because what the agent is asking for is isolation — whether that turns out to be a
   * worktree is the isolation provider's business, not this contract's.
   */
  isolation: z.literal('isolated').optional(),
  /** CC `omitClaudeMd` — the agent's runs read no workspace instruction file. */
  omitClaudeMd: z.boolean().optional(),
  /** CC `experimental.cacheTtl` — the prompt cache lifetime of the agent's runs. */
  cacheTtl: z.enum(['5m', '1h']).optional(),
  /**
   * CC `color` — display color for this agent in the task list / transcript
   * (`red`/`blue`/`green`/`yellow`/`purple`/`orange`/`pink`/`cyan`). Persisted on
   * the record + exposed in the API contract; surfaced to the runtime panel via the
   * delegate tool's result `details`.
   */
  color: z.string().optional(),
  /**
   * CC `initialPrompt` — auto-submitted as the first user turn when the agent runs as the MAIN
   * session agent: a plugin's `settings.json` `agent` leads the chat's first turn with it
   * (`chat/runtime/run/initial-prompt.ts`).
   */
  initialPrompt: z.string().optional(),
  /**
   * CC frontmatter `hooks` — lifecycle hooks scoped to this sub-agent, read with a real YAML parse
   * (the line-based parser cannot reach nested objects). PARSED + RECORDED only (raw): Claude Code
   * ignores `hooks` on a plugin agent, so the plugin loader drops them (`buildLoadedAgent`); the
   * catalog keeps them for the person's own agent files (`agents/catalog/agent-file.ts`).
   */
  hooks: z.unknown().optional(),
  /**
   * CC frontmatter `mcpServers` — servers named by reference or defined inline, for this
   * sub-agent's runs. Raw, and ignored for a plugin agent exactly as `hooks` is.
   */
  mcpServers: z.unknown().optional(),
})
export type PluginAgent = z.infer<typeof pluginAgentSchema>
