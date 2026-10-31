import { cachedIn, fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'
import { claudeCodeToolName } from '../ext/cc-tool-shapes'

/**
 * The system prompt through the mods: `prompt.section` once per section of Localix's cached
 * prompt (`agent-core/prompt/catalog-cached.ts`, by its id), `attribution.text` for the git texts
 * the model is told to write, and `prompt.compose` around the whole list. Each answer is kept for
 * the conversation until `$.ui.invalidate` (`answer-cache.ts`), so the prompt the provider caches
 * stays byte-identical from request to request while the mods answer the same.
 *
 * Localix caches its whole system prompt per conversation, with no prefix shared across people, so
 * every section it composes is `session`; a `shared` section a hook adds is placed first.
 */

export interface PromptSectionText {
  id: string
  text: string
}

/** What a system prompt is composed from, as the run resolved it. */
export interface ComposeFacts {
  /** The cached prompt's sections, in order. */
  sections: readonly PromptSectionText[]
  model: string
  /** The tools the request offers the model. */
  tools: readonly { name: string; aliases?: readonly string[] }[]
  outputStyle: { name: string; isKeepingCodingInstructions: boolean } | null
}

export interface ComposedSection {
  id: string
  text: string
  scope: 'shared' | 'session'
}

const SECTION_EVENTS = ['prompt.section', 'prompt.compose', 'attribution.text'] as const

/** Localix tells the model no attribution of its own: a mod's text is the whole of it. */
const ATTRIBUTION_KINDS = [
  { kind: 'commit', lead: 'End every git commit message you write with:' },
  { kind: 'pr', lead: 'End every pull request description you write with:' },
] as const

async function sectionOf(
  scope: ModEventScope,
  section: PromptSectionText,
): Promise<ComposedSection | null> {
  if (!hearsIn(scope, 'prompt.section')) return { ...section, scope: 'session' }
  const text = await cachedIn(scope, 'prompt.section', [section.id, section.text], async () =>
    fieldOf(
      await fireIn(scope, 'prompt.section', { name: section.id, text: section.text }, (e) => ({
        text: fieldOf(e, 'text') ?? null,
      })),
      'text',
    ),
  )
  if (text === null) return null
  return { id: section.id, text: typeof text === 'string' ? text : section.text, scope: 'session' }
}

/** `attribution.text`: the git texts a mod has the model write, as one section. */
async function attributionOf(scope: ModEventScope): Promise<ComposedSection | null> {
  if (!hearsIn(scope, 'attribution.text')) return null
  const lines = await cachedIn(scope, 'attribution.text', [], () =>
    Promise.all(
      ATTRIBUTION_KINDS.map(async ({ kind, lead }) => {
        const answer = await fireIn(scope, 'attribution.text', { kind, text: '' }, (e) => ({
          text: fieldOf(e, 'text') ?? '',
        }))
        const text = fieldOf(answer, 'text')
        return typeof text === 'string' && text.trim() ? `${lead}\n\n${text.trim()}` : ''
      }),
    ),
  )
  const body = lines.filter(Boolean).join('\n\n')
  return body ? { id: 'attribution', text: `# Git attribution\n${body}`, scope: 'session' } : null
}

/** The engine's own composition: every section through `prompt.section`, then attribution. */
export async function coreSections(
  scope: ModEventScope,
  facts: ComposeFacts,
): Promise<ComposedSection[]> {
  const sections = await Promise.all(facts.sections.map((section) => sectionOf(scope, section)))
  const attribution = await attributionOf(scope)
  return [...sections, attribution].filter((section): section is ComposedSection => !!section)
}

/** `prompt.compose`'s input: the facts, in Claude Code's names. */
export function composeInput(facts: ComposeFacts) {
  const tools = facts.tools.map((tool) => claudeCodeToolName(tool))
  return {
    model: facts.model,
    promptModel: facts.model,
    surfaces: ['desktop'],
    tools,
    outputStyle: facts.outputStyle,
    traits: tools.includes('Skill') ? ['skills'] : [],
  }
}

/** The sections a hook answered, or undefined when it answered none Localix can send. */
export function sectionsOf(answer: unknown): ComposedSection[] | undefined {
  const sections = fieldOf(answer, 'sections')
  if (!Array.isArray(sections)) return undefined
  return sections.flatMap((section): ComposedSection[] => {
    const id = fieldOf(section, 'id')
    const text = fieldOf(section, 'text')
    if (typeof id !== 'string' || typeof text !== 'string') return []
    return [{ id, text, scope: fieldOf(section, 'scope') === 'shared' ? 'shared' : 'session' }]
  })
}

const joined = (sections: readonly ComposedSection[]) =>
  [
    ...sections.filter((section) => section.scope === 'shared'),
    ...sections.filter((section) => section.scope === 'session'),
  ]
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join('\n\n')

/** The system prompt as the mods compose it, or undefined when none of them takes part. */
export async function composeSystemPrompt(
  scope: ModEventScope,
  facts: ComposeFacts,
): Promise<string | undefined> {
  if (!SECTION_EVENTS.some((event) => hearsIn(scope, event))) return undefined
  scope.host.conversations.composed(scope.scene.sessionId, facts)
  const input = composeInput(facts)
  return cachedIn(scope, 'prompt.compose', [facts.sections, input], async () => {
    const core = () => coreSections(scope, facts)
    if (!hearsIn(scope, 'prompt.compose')) return joined(await core())
    const answer = await fireIn(scope, 'prompt.compose', input, async () => ({
      sections: await core(),
    }))
    return joined(sectionsOf(answer) ?? (await core()))
  })
}
