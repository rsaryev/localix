import { isReasoningEffort } from '@localixai/agent'
import type {
  ConfigField,
  ConfigValue,
  ItemAction,
  Listing,
  ListingConfig,
  ListingDetail,
  Scope,
} from '@localixai/store'

import type { AgentModelChoice } from '../agent-core/agent-model-route'
import type { AgentRecordInput, AgentSummary } from './contracts'

/**
 * AN AGENT AS A LISTING (`docs/internals/agents-claude-code.md`, "Agents in the Store"). The id is
 * the agent's own (`cc:<uuid>`, or `builtin:<name>`), so a rename or a move keeps its page.
 *
 * Where it comes from sets its shelf: the person's files and the open project's are Yours and
 * editable; managed files, plugins' agents and the shipped types are read-only and copied to Yours
 * to change.
 */

const SOURCES: Record<string, { id: string; label: string }> = {
  user: { id: 'agents:yours', label: 'Your agents' },
  project: { id: 'agents:project', label: 'This project' },
  managed: { id: 'agents:managed', label: 'Managed by your organisation' },
  builtin: { id: 'agents:builtin', label: 'Built in' },
}

const sourceOf = (summary: AgentSummary) =>
  summary.source.startsWith('plugin:')
    ? { id: 'agents:plugins', label: `From ${summary.source.slice('plugin:'.length)}` }
    : (SOURCES[summary.source] ?? { id: 'agents:other', label: summary.source })

export const scopeOf = (summary: AgentSummary): Scope =>
  summary.scope === 'project' ? 'project' : 'user'

export function agentListing(summary: AgentSummary): Listing {
  const { record } = summary
  return {
    ref: { kind: 'agent', id: record.id },
    name: record.name,
    displayName: record.name,
    summary: record.description || 'No description',
    tags: [summary.source.startsWith('plugin:') ? 'plugin' : summary.source],
    publisher: { name: summary.editable ? 'You' : sourceOf(summary).label, verified: false },
    source: sourceOf(summary),
    contents: { agent: 1 },
    runsCode: false,
    featured: false,
    recommended: false,
    installs: [{ scope: scopeOf(summary), enabled: summary.enabled }],
    ...(summary.source === 'builtin' || summary.source.startsWith('plugin:')
      ? { bundled: true }
      : {}),
    ...(summary.editable ? { authored: summary.scope === 'project' ? 'project' : 'user' } : {}),
    configurable: true,
  } as Listing
}

export function agentDetail(summary: AgentSummary, chats = 0): ListingDetail {
  const { record } = summary
  const facts: [string, string | undefined][] = [
    ['Kept in', sourceOf(summary).label],
    ['File', summary.path || undefined],
    ['Used by', chats > 0 ? `${chats} ${chats === 1 ? 'chat' : 'chats'}` : undefined],
  ]
  return {
    ...agentListing(summary),
    readme: record.instructions || null,
    media: [],
    facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    components: [{ kind: 'agent', name: record.name }],
  }
}

const field = (
  key: string,
  label: string,
  help: string,
  over: Partial<ConfigField> = {},
): ConfigField => ({ key, label, help, type: 'string', required: false, secret: false, ...over })

export const NAME_FIELD = field(
  'name',
  'Name',
  'Letters, numbers and dashes. @name and Agent use it.',
  { required: true },
)
export const DESCRIPTION_FIELD = field('description', 'Description', 'When to use this agent.', {
  required: true,
})

/** The Definition: what an agent file's frontmatter and body hold that Localix edits. */
export const DEFINITION_FIELDS: ConfigField[] = [
  NAME_FIELD,
  DESCRIPTION_FIELD,
  field('instructions', 'Instructions', 'The agent’s prompt, in Markdown.', {
    required: true,
    multiline: true,
  }),
  field(
    'model',
    'Model',
    'The model this agent runs on. Empty: the model of the chat it runs in.',
    {
      type: 'model',
    },
  ),
  field('effort', 'Effort', 'How hard it reasons.', {
    type: 'choice',
    options: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value })),
  }),
  field('maxTurns', 'Turn limit', 'Most turns one run takes.', { type: 'number', min: 1 }),
  field('skills', 'Skills', 'Skills loaded into its context.', { type: 'list' }),
]

export const COPY: ItemAction = {
  id: 'copy',
  label: 'Copy to Yours',
  help: 'An editable copy in your agents folder',
}
export const DUPLICATE: ItemAction = {
  id: 'duplicate',
  label: 'Duplicate',
  help: 'Another agent with the same definition',
}

/** The model and effort fields hold the person's choice (Localix settings), not the agent's file. */
export function agentConfig(
  summary: AgentSummary,
  revision?: string,
  choice?: AgentModelChoice,
): ListingConfig {
  const scope = scopeOf(summary)
  const base = { scope, scopes: [scope], set: [] }
  if (!summary.editable) return { ...base, fields: [], values: {}, actions: [COPY] }
  const move: ItemAction =
    scope === 'user'
      ? { id: 'move', label: 'Move to project', help: 'Keep it in the open project instead' }
      : { id: 'move', label: 'Move to user', help: 'Keep it in your agents folder instead' }
  const { record } = summary
  return {
    ...base,
    fields: DEFINITION_FIELDS,
    values: {
      name: record.name,
      description: record.description,
      instructions: record.instructions,
      model: choice?.modelId ?? null,
      effort: choice?.effort ?? null,
      maxTurns: record.maxTurns ?? null,
      skills: record.skills ?? [],
    },
    actions: [DUPLICATE, move],
    ...(revision ? { revision } : {}),
  }
}

const str = (values: Record<string, ConfigValue>, key: string, fallback = '') => {
  const value = values[key]
  return typeof value === 'string' ? value : fallback
}

/** The definition a saved form means: the record with the given keys replaced. */
export function inputFromValues(
  summary: AgentSummary,
  values: Record<string, ConfigValue>,
): AgentRecordInput {
  const { record } = summary
  const has = (key: string) => key in values
  const preload = Array.isArray(values.skills) ? values.skills : record.skills
  const skills = preload?.length ? preload : undefined
  const turns = values.maxTurns
  const maxTurns = has('maxTurns')
    ? typeof turns === 'number'
      ? turns
      : undefined
    : record.maxTurns
  return {
    name: str(values, 'name', record.name).trim(),
    description: str(values, 'description', record.description),
    instructions: str(values, 'instructions', record.instructions),
    ...(maxTurns ? { maxTurns } : {}),
    ...(skills ? { skills } : {}),
    projectId: summary.projectId || null,
  }
}

/**
 * The person's choice for an agent after a saved form: the form's model and effort over the
 * choice kept so far (a key the form does not carry stays), or none when both are empty.
 */
export function choiceFromValues(
  agentId: string,
  values: Record<string, ConfigValue>,
  kept?: AgentModelChoice,
): AgentModelChoice | undefined {
  const model = 'model' in values ? str(values, 'model').trim() : (kept?.modelId ?? '')
  const asked = 'effort' in values ? str(values, 'effort') : (kept?.effort ?? '')
  const effort = isReasoningEffort(asked) ? asked : undefined
  // A model typed over another one drops the connection that went with it.
  const connection = model && model === kept?.modelId ? kept.providerConnectionId : undefined
  if (!model && !effort) return undefined
  return {
    agentId,
    ...(model ? { modelId: model } : {}),
    ...(connection ? { providerConnectionId: connection } : {}),
    ...(effort ? { effort } : {}),
  }
}
