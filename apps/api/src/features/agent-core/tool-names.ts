import type { ToolExposure } from '@localixai/agent/agents'
import {
  CHAT_AND_CHILD,
  CHAT_DEFAULT,
  CHAT_ONLY,
  EVERYWHERE,
  type BuiltinToolDefinition,
} from './tool-exposure'
import { ACTIVATE_TOOLS_TOOL_NAME, RESERVED_NON_TOOL_NAMES } from './tool-names-reserved'
import { SUBAGENT_TOOL_CATALOG } from './tool-names-subagents'

export type { BuiltinToolCategory, BuiltinToolDefinition } from './tool-exposure'

/**
 * The ONE declarative inventory of every core-owned model tool.
 *
 * Runtime/profile assembly filters this inventory by policy and host dependencies;
 * the settings endpoint projects it verbatim; plugin reservation and config
 * validation derive their vocabulary from it. No consumer maintains another list
 * of which built-ins exist.
 */
export const BUILTIN_TOOL_CATALOG = {
  AskUserQuestion: {
    name: 'AskUserQuestion',
    label: 'Ask user',
    description: 'Request a user decision with concrete options when human input is required.',
    category: 'core',
    exposure: CHAT_ONLY,
  },
  ContextBudget: {
    name: 'ContextBudget',
    label: 'Context budget',
    description:
      'Report how much of the context window is used and what remains before the next context checkpoint.',
    category: 'core',
    exposure: CHAT_DEFAULT,
  },
  Bash: {
    name: 'Bash',
    label: 'Shell commands',
    description:
      'Run shell commands, compile, test, install packages, and inspect repository state.',
    category: 'core',
    // A child with no shell cannot VERIFY its own edits; the parent then re-reads the very
    // files delegation existed to keep out of its context.
    exposure: EVERYWHERE,
  },
  Read: {
    name: 'Read',
    label: 'Read files',
    description: 'Read text files, images, PDF/office documents, notebooks and directories.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  Search: {
    name: 'Search',
    label: 'Search code',
    description: 'Search file contents with ripgrep across the project.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  Write: {
    name: 'Write',
    label: 'Write files',
    description: 'Write or overwrite a file when the full new content is known.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  Edit: {
    name: 'Edit',
    label: 'Edit file',
    description: 'Replace one exact span of text in an existing file.',
    category: 'filesystem',
    exposure: EVERYWHERE,
  },
  Research: {
    name: 'Research',
    label: 'Research',
    description: 'Search the web and read relevant sources.',
    category: 'knowledge',
    exposure: CHAT_AND_CHILD,
  },
  GlobalSearch: {
    name: 'GlobalSearch',
    label: 'Global search',
    description:
      'Search chats, messages, files and every searchable resource; read past conversations.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  ToolOutput: {
    name: 'ToolOutput',
    label: 'Tool output',
    description: 'Search or recover stored tool outputs from the current session.',
    category: 'knowledge',
    // An elided result advertises this tool by name; without it the pointer is a dead end.
    exposure: EVERYWHERE,
  },
  McpResources: {
    name: 'McpResources',
    label: 'MCP resources',
    description: 'List and read resources exposed by connected Model Context Protocol servers.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  Vault: {
    name: 'Vault',
    deferred: true,
    label: 'Secret vault',
    description: 'Manage encrypted credential metadata without exposing secret values.',
    category: 'knowledge',
    // A child running `psql` needs the credential; the tool itself declines its
    // human-answered actions when no human can see the prompt (features/secrets).
    exposure: CHAT_DEFAULT,
  },
  ExternalAgentSessions: {
    name: 'ExternalAgentSessions',
    deferred: true,
    label: 'External agent sessions',
    description:
      'Inspect external CLI sessions: roster, transcript, context, state, wait, usage. To open a session for the user, resolve its native command with resume, then execute it with `Bash` action:"open". Reading a transcript does not open a session.',
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  Skill: {
    name: 'Skill',
    label: 'Skills',
    description: 'Save and retrieve reusable agent skills.',
    category: 'knowledge',
    // Delegated implementers need the same procedures as the parent. Without this,
    // the host removes both the retrieval tool and its catalog from their prompt.
    exposure: CHAT_AND_CHILD,
  },
  Jobs: {
    name: 'Jobs',
    label: 'Background jobs',
    description: 'Inspect and control background tool jobs.',
    category: 'automation',
    // Background bash is off for every unattended run, so a child has nothing to manage.
    exposure: CHAT_ONLY,
  },
  Browser: {
    name: 'Browser',
    label: 'Browser',
    description: 'Open and drive Browser tabs: local previews and remote sites.',
    category: 'ui',
    // Children verify their own deliverables through their own session's preview port.
    exposure: { chat: 'default', subagent: 'opt-in', automation: 'default' },
  },
  Store: {
    name: 'Store',
    label: 'Store',
    description:
      'Find, install, update, switch and remove packages from the Store’s added sources, and create agents and skills.',
    category: 'automation',
    // A person approves every change, and a delegated child has no one to ask.
    exposure: CHAT_ONLY,
  },
  ...SUBAGENT_TOOL_CATALOG,
  Workflow: {
    name: 'Workflow',
    // Waits behind `ToolSearch`; a workflow command activates it for its session.
    deferred: true,
    label: 'Workflow',
    description:
      'Run a plugin workflow: a script that runs many agents in child sessions and returns one result.',
    category: 'automation',
    // Its agents are children of the chat that runs it, and a child may not create children.
    exposure: CHAT_ONLY,
  },
  Loops: {
    name: 'Loops',
    label: 'Loops',
    description: 'Create and manage the session loops: fixed-cadence and self-pacing jobs.',
    category: 'automation',
    // Claude Code removes `ScheduleWakeup` from every subagent, even one that lists it: a loop
    // belongs to the conversation that schedules it.
    exposure: { chat: 'default', subagent: 'never', automation: 'opt-in' },
  },
  MiniAppGuide: {
    name: 'MiniAppGuide',
    label: 'Mini app guides',
    description: "Read an enabled mini app's guide before using its tools.",
    category: 'knowledge',
    exposure: CHAT_DEFAULT,
  },
  Configure: {
    name: 'Configure',
    deferred: true,
    label: 'Configure',
    // Proposes; never applies. The user's click on the `config_change` card is the authority.
    // Root chat only: a sub-session must never learn configuration is a thing it could rewrite.
    description: 'Inspect unavailable capabilities and propose configuration changes for approval.',
    category: 'core',
    exposure: CHAT_ONLY,
  },
  Plan: {
    name: 'Plan',
    label: 'Plan',
    // In every mode: `present` gates itself on plan mode, `complete` on an approved plan. Root
    // chat only — the person reviews the conversation's plan; a child reports to its delegator.
    description:
      "The conversation's plan: present it for review in plan mode, re-read it, and mark the approved plan complete.",
    category: 'core',
    exposure: CHAT_ONLY,
  },
} as const satisfies Record<string, BuiltinToolDefinition>

export type BuiltinToolCatalog = typeof BUILTIN_TOOL_CATALOG
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
 * The consolidated MCP-resource tool. Core-named (so settings can toggle it and a mini app cannot
 * shadow it), but MCP-provenance: it is only built when a connected server advertises
 * `resources`, and run assembly defers it along with the rest of the MCP surface.
 */
export const MCP_RESOURCE_TOOL_NAMES: readonly string[] = [TOOL.McpResources]

/**
 * Core tools the model meets through `ToolSearch` instead of on the wire (`deferred` in the
 * catalog): an open toolset offers them there, a list that names the tool keeps them on the wire.
 */
const DEFERRED_CORE_TOOLS: ReadonlySet<string> = new Set(
  Object.values(BUILTIN_TOOL_CATALOG as Record<string, BuiltinToolDefinition>)
    .filter((definition) => definition.deferred)
    .map((definition) => definition.name),
)

export const isDeferredCoreTool = (name: string): boolean => DEFERRED_CORE_TOOLS.has(name)

/**
 * Complete core-owned namespace reserved against plugin shadowing: every tool's name, the
 * activator's, and the names of core mechanisms that are not tools.
 */
export const CORE_RESERVED_TOOL_NAMES: readonly string[] = [
  ...BUILTIN_TOOL_NAMES,
  ACTIVATE_TOOLS_TOOL_NAME,
  ...RESERVED_NON_TOOL_NAMES,
]
