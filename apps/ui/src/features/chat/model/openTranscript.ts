import type { Message } from '@/shared/api/contracts'
import type { PluginTranscriptAction } from '@localixai/plugin-sdk/ui/runtime'
import { inspector } from '@/shared/lib/inspectorBus'

export interface TranscriptActionDestination {
  readonly sessionId: string
  /** The project the imported session landed in — every session has one. */
  readonly projectId: string
}

/**
 * Open a conversation in the app's own transcript surface.
 *
 * THIS IS THE WHOLE API for anyone with a conversation to show — an external agent's history read
 * off disk, an imported archive, a replay. A caller shapes its source into our `Message[]`, calls
 * this, and is done: the tab, the find bar, the scrolling, the virtualized list, the tool cards and
 * the scroll-to-bottom pill are all ours. Nothing about where the messages came from crosses this
 * line, and no caller renders a transcript of its own.
 *
 * It is a VIEW, not a session: nothing is created on the server, no session is switched, no history
 * is written. Reading someone else's conversation should not disturb yours.
 */
export interface OpenTranscriptInput {
  /** Stable identity, namespaced by origin (`external-agent:claude-code:0c61…`). Re-opening the
   *  same id replaces the content in the tab that already has it. */
  readonly id: string
  /**
   * The chat whose workspace the transcript tab opens in. Reading it is not joining it — the
   * transcript stays a view — but every tab belongs to one chat, and an open that named none was
   * stamped with whichever chat was on screen.
   */
  readonly sessionId?: string
  readonly title: string
  readonly messages: readonly Message[]
  /**
   * The tools in these messages are named in a vocabulary that is not ours. A tool called `bash`
   * or `read` in someone else's transcript shares a name with ours and nothing else, so every tool
   * renders as generic IN/OUT instead of through a card written for our payload shapes.
   */
  readonly foreignTools?: boolean
  /**
   * Optional next step for a read-only transcript.
   *
   * Kept beside the in-memory content because callbacks cannot be serialized into a work-item
   * payload. A transcript without an action stays a plain reader.
   */
  readonly action?: PluginTranscriptAction
  readonly actions?: readonly PluginTranscriptAction[]
}

/** Content lives here, not in the work item's payload: payloads are serialized into the persisted
 *  grid layout, and a transcript is far too large to belong in one. A tab restored after a reload
 *  therefore finds nothing and says so, which is the honest outcome for a view of a file the app
 *  does not own. */
const open = new Map<string, OpenTranscriptInput>()

export function transcriptTabId(id: string): string {
  return `transcript:${id}`
}

export function readTranscript(id: string): OpenTranscriptInput | undefined {
  return open.get(id)
}

export function openTranscript(input: OpenTranscriptInput): void {
  if (!input.sessionId) throw new Error('A session-scoped transcript needs its owning conversation')
  open.set(input.id, input)
  inspector.openWorkItem({
    workKind: 'transcript',
    id: transcriptTabId(input.id),
    title: input.title,
    scope: input.sessionId,
    payload: { transcriptId: input.id },
  })
}

/** App-level archive viewers retain the same content without inventing a Localix conversation. */
export function rememberTranscript(input: OpenTranscriptInput): void {
  open.set(input.id, input)
}

/** Drop every transcript whose tab is gone, so a long session does not accumulate histories. */
export function forgetTranscripts(keep: ReadonlySet<string>): void {
  for (const id of open.keys()) if (!keep.has(id)) open.delete(id)
}
