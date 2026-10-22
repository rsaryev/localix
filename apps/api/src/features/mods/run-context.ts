import { cachedIn, fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'

/**
 * The runtime context a turn carries through the mods. Localix sends what Claude Code puts in a
 * conversation's first user message — the date, the environment, the participants, the jobs —
 * as keyed sections inside the conversation (`agent-core/prompt/runtime-sections.ts`): a standing
 * (`state`) section is a `prompt.context` block, named by its key; a section about this turn
 * alone (`turn`: a reminder, a hook's context, the turn's trigger) is an attachment the engine
 * injects, raised as `prompt.attachment` with its key as the type. Both answers are kept for the
 * conversation until `$.ui.invalidate`, so an unchanged context is not asked again.
 */

export interface ContextSection {
  key: string
  scope: 'state' | 'turn'
  text: string
}

/** Who wrote a turn section: Claude Code's settings hooks and a mod's `context`, or Localix. */
const originOf = (key: string) =>
  key === 'hook-context' ? { kind: 'hook', event: 'UserPromptSubmit' } : { kind: 'engine' as const }

async function contextBlocks(
  scope: ModEventScope,
  state: readonly ContextSection[],
): Promise<ContextSection[]> {
  if (state.length === 0 || !hearsIn(scope, 'prompt.context')) return [...state]
  const blocks = state.map((section) => ({ name: section.key, text: section.text }))
  const answered = await cachedIn(scope, 'prompt.context', [blocks], async () =>
    fieldOf(
      await fireIn(scope, 'prompt.context', { blocks }, (e) => ({
        blocks: fieldOf(e, 'blocks') ?? [],
      })),
      'blocks',
    ),
  )
  if (!Array.isArray(answered)) return [...state]
  return answered.flatMap((block): ContextSection[] => {
    const name = fieldOf(block, 'name')
    const text = fieldOf(block, 'text')
    return typeof name === 'string' && typeof text === 'string' && text.trim()
      ? [{ key: name, scope: 'state', text }]
      : []
  })
}

async function attachmentOf(
  scope: ModEventScope,
  section: ContextSection,
): Promise<ContextSection | null> {
  const input = { type: section.key, text: section.text, origin: originOf(section.key) }
  const text = await cachedIn(scope, 'prompt.attachment', [section.key, section.text], async () =>
    fieldOf(
      await fireIn(scope, 'prompt.attachment', input, (e) => ({
        text: fieldOf(e, 'text') ?? null,
      })),
      'text',
    ),
  )
  if (text === null) return null
  return typeof text === 'string' ? { ...section, text } : section
}

/** `prompt.context` and `prompt.attachment` over a turn's runtime sections, in their order. */
export async function runtimeContext(
  scope: ModEventScope,
  sections: readonly ContextSection[],
): Promise<ContextSection[]> {
  const blocks = hearsIn(scope, 'prompt.context')
  const attachments = hearsIn(scope, 'prompt.attachment')
  if (!blocks && !attachments) return [...sections]
  const state = await contextBlocks(
    scope,
    sections.filter((section) => section.scope === 'state'),
  )
  const turn = sections.filter((section) => section.scope === 'turn')
  const kept = attachments
    ? (await Promise.all(turn.map((section) => attachmentOf(scope, section)))).filter(
        (section): section is ContextSection => section !== null,
      )
    : turn
  return [...state, ...kept]
}
