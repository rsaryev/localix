import type { ToolExposure } from '@localixai/agent/agents'
import { RESERVED_NON_TOOL_NAMES } from './tool-names-reserved'

export type BuiltinToolCategory = 'core' | 'filesystem' | 'knowledge' | 'automation' | 'ui'

export interface BuiltinToolDefinition {
  name: string
  label: string
  description: string
  category: BuiltinToolCategory
  /** Which run shapes may carry the tool — the ledger's first gate and the source of each
   *  shape's default surface (`run-shape.ts`). There is no other list of "what a child gets". */
  exposure: ToolExposure
  /** Conversation protocol primitives remain available wherever their host offers them. */
  protocol?: boolean
}

// The exposure vocabulary, spelled once. `never` is the structural bound: a child is never
// TOLD about such a tool either, so it cannot spend a turn discovering it cannot have it.
const EVERYWHERE: ToolExposure = { chat: 'default', subagent: 'default', automation: 'default' }
const CHAT_AND_CHILD: ToolExposure = { chat: 'default', subagent: 'default', automation: 'opt-in' }
const CHAT_DEFAULT: ToolExposure = { chat: 'default', subagent: 'opt-in', automation: 'opt-in' }
const CHAT_ONLY: ToolExposure = { chat: 'default', subagent: 'never', automation: 'never' }
const CONVERSATION_TREE: ToolExposure = {
  chat: 'default',
  subagent: 'never',
  automation: 'never',
}

/**
 * The ONE declarative inventory of every core-owned model tool.
 *
 * Runtime/profile assembly filters this inventory by policy and host dependencies;
 * the settings endpoint projects it verbatim; plugin reservation and config
 * validation derive their vocabulary from it. No consumer maintains another list
 * of which built-ins exist.
 */
export const BUILTIN_TOOL_CATALOG = {
  ask: {
    name: 'ask',
    label: 'Ask user',
    description: 'Request a user decision with concrete options when human input is required.',
    category: 'core',
    exposure: CHAT_ONLY,
  },
  context_budget: {
    name: 'context_budget',
    label: 'Context budget',
    description:
      'Report how much of the context window is used and what remains before the next context checkpoint.',
    category: 'core',
    exposure: CHAT_AND_CHILD,
  },
  bash: {
    name: 'bash',
    label: 'Shell commands',
    description:
      'Run shell commands, compile, test, install packages, and inspect repository state.',
    category: 'core',
    // A child with no shell cannot VERIFY its own edits; the parent then re-reads the very
    // files delegation existed to keep out of its context.
    exposure: EVERYWHERE,
  },
  read: {
    name: 'read',
    label: 'Read files',
    description: 'Read file contents with size metadata.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  view_image: {
    name: 'view_image',
    label: 'View image',
    description: 'Look at a PNG, JPEG, GIF or WebP file as native visual content.',
    category: 'filesystem',
    exposure: CHAT_AND_CHILD,
  },
  search: {
    name: 'search',
    label: 'Search code',
    description: 'Search file contents with ripgrep across the project.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  write: {
    name: 'write',
    label: 'Write files',
    description: 'Write or overwrite a file when the full new content is known.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  edit: {
    name: 'edit',
    label: 'Edit file',
    description: 'Replace one exact span of text in an existing file.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  apply_patch: {
    name: 'apply_patch',
    label: 'Apply patch',
    description: 'Apply targeted multi-file patches without rewriting whole files.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  research: {
    name: 'research',
    label: 'Research',
    description: 'Search the web and read relevant sources.',
    category: 'knowledge',
    exposure: CHAT_AND_CHILD,
  },
  memory: {
    name: 'memory',
    label: 'Memory',
    description: 'Persist and recall notes across sessions.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  history_search: {
    name: 'history_search',
    label: 'History search',
    description: 'Search across past conversation messages.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  tool_output: {
    name: 'tool_output',
    label: 'Tool output',
    description: 'Search or recover stored tool outputs from the current session.',
    category: 'knowledge',
    // An elided result advertises this tool by name; without it the pointer is a dead end.
    exposure: EVERYWHERE,
  },
  mcp_resources: {
    name: 'mcp_resources',
    label: 'MCP resources',
    description: 'List and read resources exposed by connected Model Context Protocol servers.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  vault: {
    name: 'vault',
    label: 'Secret vault',
    description: 'Manage encrypted credential metadata without exposing secret values.',
    category: 'knowledge',
    // A child running `psql` needs the credential; the tool itself declines its
    // human-answered actions when no human can see the prompt (features/secrets).
    exposure: CHAT_AND_CHILD,
  },
  external_agent_sessions: {
    name: 'external_agent_sessions',
    label: 'External agent sessions',
    description:
      'Inspect external CLI sessions: roster, transcript, context, state, wait, usage. To open a session for the user, resolve its native command with resume, then execute it with bash action:"open". Reading a transcript does not open a session.',
    category: 'knowledge',
    exposure: CHAT_AND_CHILD,
  },
  skill: {
    name: 'skill',
    label: 'Skills',
    description: 'Create, retrieve, list, and delete reusable agent skills.',
    category: 'knowledge',
    // Delegated implementers need the same procedures as the parent. Without this,
    // the host removes both the retrieval tool and its catalog from their prompt.
    exposure: CHAT_AND_CHILD,
  },
  jobs: {
    name: 'jobs',
    label: 'Background jobs',
    description: 'Inspect and control background tool jobs.',
    category: 'automation',
    // Background bash is off for every unattended run, so a child has nothing to manage.
    exposure: CHAT_ONLY,
  },
  browser: {
    name: 'browser',
    label: 'Browser',
    description: 'Open and drive Browser tabs: local previews and remote sites.',
    category: 'ui',
    // Children verify their own deliverables through their own session's preview port.
    exposure: EVERYWHERE,
  },
  agents: {
    name: 'agents',
    label: 'Agents',
    description: 'Delegate tasks to child agents or teams, and message, stop or close them.',
    category: 'automation',
    // Only root chats build the delegation port. No subsession may acquire it from its profile.
    exposure: CONVERSATION_TREE,
  },
  loops: {
    name: 'loops',
    label: 'Loops',
    description: 'Create and manage the session loops: fixed-cadence and self-pacing jobs.',
    category: 'automation',
    exposure: CHAT_DEFAULT,
  },
  plugin_build: {
    name: 'plugin_build',
    label: 'Build plugins',
    description: "Create, build, test and reload the user's own plugins.",
    category: 'automation',
    exposure: CHAT_DEFAULT,
  },
  conversation_control: {
    name: 'conversation_control',
    label: 'Conversation control',
    description:
      'Finish a group turn, invite or remove participants, and schedule the next speakers.',
    category: 'ui',
    exposure: { chat: 'default', subagent: 'opt-in', automation: 'never' },
    protocol: true,
  },
  configure: {
    name: 'configure',
    label: 'Configure',
    // Proposes; never applies. The user's click on the `config_change` card is the authority.
    // Root chat only: a sub-session must never learn configuration is a thing it could rewrite.
    description: 'Inspect unavailable capabilities and propose configuration changes for approval.',
    category: 'core',
    exposure: CHAT_ONLY,
  },
  plan: {
    name: 'plan',
    label: 'Plan',
    // In every mode: `present` gates itself on plan mode, `complete` on an approved plan. Root
    // chat only — the person reviews the conversation's plan; a child reports to its delegator.
    description:
      "The conversation's plan: present it for review in plan mode, re-read it, and mark the approved plan complete.",
    category: 'core',
    exposure: CHAT_ONLY,
  },
} as const satisfies Record<string, BuiltinToolDefinition>

type BuiltinToolCatalog = typeof BUILTIN_TOOL_CATALOG
type BuiltinToolNameMap = {
  readonly [K in keyof BuiltinToolCatalog]: BuiltinToolCatalog[K]['name']
}

/** Name constants are a projection of the canonical catalog, never a second declaration. */
export const TOOL = Object.fromEntries(
  Object.entries(BUILTIN_TOOL_CATALOG).map(([key, definition]) => [key, definition.name]),
) as BuiltinToolNameMap

/**
 * The name of a built-in tool — the OWNER of that vocabulary, usable as a key type.
 * Clients that keep a per-tool table (the web transcript's presentation meta) key it
 * on this, so adding a built-in without teaching the client about it fails to compile
 * instead of silently rendering as an unlabeled fallback.
 *
 * NOT every tool name in the system: server-provided MCP call tools and plugin tools
 * are discovered dynamically and stay `string` on the client side. Core-owned,
 * conditionally built MCP resource tools remain in this catalog so settings and the
 * runtime share their disable policy.
 */
export type ToolName = BuiltinToolCatalog[keyof BuiltinToolCatalog]['name']

export const BUILTIN_TOOL_NAMES: readonly string[] = Object.values(TOOL)

export const isProtocolTool = (name: string): boolean =>
  (BUILTIN_TOOL_CATALOG as Record<string, BuiltinToolDefinition>)[name]?.protocol === true

/** The catalog's exposure for a built-in name — `undefined` for a plugin/MCP name. */
export function builtinToolExposure(name: string): ToolExposure | undefined {
  const definition = (BUILTIN_TOOL_CATALOG as Record<string, BuiltinToolDefinition>)[name]
  return definition?.exposure
}

// The names outside the catalog are declared in a sibling leaf that imports NOTHING, and the
// two that need the catalog are composed HERE. The edge runs one way on purpose: a sibling
// reading `TOOL` back would be evaluated before this module finished initializing it.
export { ACTIVATE_TOOLS_TOOL_NAME } from './tool-names-reserved'

/**
 * The consolidated MCP-resource tool. Core-named (so settings can toggle it and a plugin cannot
 * shadow it), but MCP-provenance: it is only built when a connected server advertises
 * `resources`, and run assembly defers it along with the rest of the MCP surface.
 */
export const MCP_RESOURCE_TOOL_NAMES: readonly string[] = [TOOL.mcp_resources]

/** Complete core-owned namespace reserved against plugin shadowing. */
export const CORE_RESERVED_TOOL_NAMES: readonly string[] = [
  ...BUILTIN_TOOL_NAMES,
  ...RESERVED_NON_TOOL_NAMES,
]
