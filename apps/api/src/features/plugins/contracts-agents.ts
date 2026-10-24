import { z } from 'zod'
import { PLUGIN_QUALIFIED_NAME_RE } from './contracts-base'

/**
 * A custom worker ROLE a plugin contributes — the same thing a registry agent is, declared in a
 * manifest instead of a file. Shape mirrors the dispatchable fields (name/description/prompt/
 * tools) a forked run takes, so an enabled plugin agent rides the existing dispatch. Selected as
 * `<plugin>:<name>` (a skill's `agent:`). Pure manifest data.
 */
export const pluginAgentSchema = z.object({
  // Accepts a namespaced `foo:bar` name (nested `agents/foo/bar.md`); a plain name is
  // the single-segment case (PLUGIN_QUALIFIED_NAME_RE ⊇ PLUGIN_NAME_RE). Assignee
  // resolution splits on the FIRST `:` so `<plugin>:foo:bar` still routes correctly.
  name: z.string().regex(PLUGIN_QUALIFIED_NAME_RE),
  label: z.string().max(60).optional(),
  description: z.string().default(''),
  /** The worker identity/system prompt for this role. */
  prompt: z.string().min(1),
  /** Tool allowlist (engine tool names). Omit to inherit the generic worker surface. */
  tools: z.array(z.string()).optional(),
  /**
   * CC `disallowedTools` — engine tool names removed from the worker's surface.
   * Applied when the agent is dispatched as a delegated task run or sub-agent via `delegate`.
   */
  disallowedTools: z.array(z.string()).optional(),
  /**
   * CC `model` — preferred model alias for this agent (e.g. "opus", "sonnet", a full
   * model id). Informational hint; the canonical `agentSettings.modelRouting` takes
   * precedence, but this can be surfaced in the Settings picker as a suggested default.
   */
  preferredModel: z.string().optional(),
  /**
   * CC `skills` — skill names to preload into the agent's context when it runs.
   * The agent sees these skills' full content, not just their descriptions.
   * Comma/space-separated string or YAML inline array.
   * At dispatch time these are set on the worker session as `pinnedSkills` so the
   * skill tool and prompt-context include them in the worker's context window.
   */
  pinnedSkills: z.array(z.string()).optional(),
  /**
   * CC `effort` — preferred reasoning effort for this agent (e.g. "high", "low").
   * Advisory; the session's settings take precedence.
   */
  preferredEffort: z.string().optional(),
  /**
   * CC `maxTurns` — max agentic turns (tool batches) before the sub-agent stops.
   * ENFORCED: the delegate runtime caps the child run's `n` (turn limit) at this.
   */
  maxTurns: z.number().int().positive().optional(),
  /**
   * CC `background` — a `delegate` start as this agent never holds the call for its report, even
   * with `wait: true` (`agent-core/tools/delegate-plugin-agent.ts`).
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
   * The agent asked to run in a directory of its own: a `delegate` start as this agent works in a
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
   * CC frontmatter `hooks` — lifecycle hooks scoped to this sub-agent. PARSED +
   * RECORDED only (raw): Claude Code ignores `hooks` on a plugin agent, and so does `delegate`.
   * The line-based markdown frontmatter parser cannot extract nested hook objects,
   * so this is populated from the lossless `.json` / `--agents` JSON form.
   */
  hooks: z.unknown().optional(),
})
export type PluginAgent = z.infer<typeof pluginAgentSchema>
