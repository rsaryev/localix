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
    name: record.handle,
    displayName: record.handle,
    summary: record.description || 'No description',
    tags: [summary.source.startsWith('plugin:') ? 'plugin' : summary.source],
    publisher: { name: summary.editable ? 'You' : sourceOf(summary).label, verified: false },
    source: sourceOf(summary),
    contents: { agent: 1 },
    runsCode: false,
    featured: false,
    recommended: false,
    installs: [{ scope: scopeOf(summary), enabled: summary.enabled }],
    ...(summary.editable ? { authored: summary.scope === 'project' ? 'project' : 'user' } : {}),
    configurable: true,
  } as Listing
}

export function agentDetail(summary: AgentSummary): ListingDetail {
  const { record } = summary
  const facts: [string, string | undefined][] = [
    ['Kept in', sourceOf(summary).label],
    ['File', summary.path || undefined],
    ['Priority', record.leadershipPriority ? String(record.leadershipPriority) : undefined],
  ]
  return {
    ...agentListing(summary),
    readme: record.instructions || null,
    media: [],
    facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    components: [{ kind: 'agent', name: record.handle }],
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
  field('model', 'Model', 'A model, an alias, or provider/model. Empty: the chat’s.', {
    type: 'model',
  }),
  field('effort', 'Effort', 'How hard it reasons.', {
    type: 'choice',
    options: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value })),
  }),
  field('maxTurns', 'Turn limit', 'Most turns one run takes.', { type: 'number', min: 1 }),
  field('skills', 'Skills', 'Skills loaded into its context.', { type: 'list' }),
  field('priority', 'Priority', 'Who leads a conversation: -2 to 2.', {
    type: 'number',
    min: -2,
    max: 2,
  }),
  field('memoryScope', 'Memory', 'Where it remembers.', {
    type: 'choice',
    options: ['global', 'project', 'session'].map((value) => ({ value })),
  }),
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

export function agentConfig(summary: AgentSummary): ListingConfig {
  const scope = scopeOf(summary)
  const base = { scope, scopes: [scope], set: [] }
  if (!summary.editable) return { ...base, fields: [], values: {}, actions: [COPY] }
  const { record } = summary
  const route = [record.modelPreference?.provider, record.modelPreference?.model]
    .filter(Boolean)
    .join('/')
  return {
    ...base,
    fields: DEFINITION_FIELDS,
    values: {
      name: record.handle,
      description: record.description,
      instructions: record.instructions,
      model: route || null,
      effort: record.modelPreference?.effort ?? null,
      maxTurns: record.limits?.maxTurns ?? null,
      skills: record.context?.preloadSkills ?? [],
      priority: record.leadershipPriority,
      memoryScope: record.context?.memory?.scope ?? null,
    },
    actions: [DUPLICATE],
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
  const preference = { ...record.modelPreference }
  if (has('model')) {
    const model = str(values, 'model').trim()
    const slash = model.indexOf('/')
    delete preference.provider
    delete preference.model
    if (model) {
      if (slash > 0) preference.provider = model.slice(0, slash)
      preference.model = slash > 0 ? model.slice(slash + 1) : model
    }
  }
  if (has('effort')) {
    const effort = str(values, 'effort')
    if (isReasoningEffort(effort)) preference.effort = effort
    else delete preference.effort
  }
  const memory = has('memoryScope') ? str(values, 'memoryScope') : record.context?.memory?.scope
  const preload = Array.isArray(values.skills) ? values.skills : record.context?.preloadSkills
  const context = {
    ...(preload?.length ? { preloadSkills: preload } : {}),
    ...(memory ? { memory: { scope: memory as 'global' | 'project' | 'session' } } : {}),
  }
  const turns = values.maxTurns
  const maxTurns = has('maxTurns')
    ? typeof turns === 'number'
      ? turns
      : undefined
    : record.limits?.maxTurns
  const priority = values.priority
  return {
    handle: str(values, 'name', record.handle).trim(),
    description: str(values, 'description', record.description),
    instructions: str(values, 'instructions', record.instructions),
    leadershipPriority: typeof priority === 'number' ? priority : record.leadershipPriority,
    ...(Object.keys(preference).length ? { modelPreference: preference } : {}),
    ...(maxTurns ? { limits: { maxTurns } } : {}),
    ...(Object.keys(context).length ? { context } : {}),
    projectId: summary.projectId || null,
  }
}
