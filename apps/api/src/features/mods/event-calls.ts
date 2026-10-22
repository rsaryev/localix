import type { ModScene } from './contracts'
import { fieldOf } from './event-scope'
import type { ModsHost } from './host'
import { coreSections, type ComposeFacts } from './run-prompt'

/**
 * The cores of the `$` calls that ask the engine one of its own events. A mod's call is the event
 * (`interceptApi`): the other mods' hooks run around these, as around the engine's own. Each
 * answers as Localix's core does at that event — the composition of the conversation's system
 * prompt, a compaction requested — or, for a describing event with no state behind it, echoes
 * what it was handed, as the engine's core does.
 */

type Event = Record<string, unknown>

const field = (e: unknown, name: string, fallback: unknown) => fieldOf(e, name) ?? fallback

/** What the engine's core answers at each describing event: what reached it. */
export const DESCRIBING_CORES = {
  tool: {
    describe: (e: Event) => ({
      description: field(e, 'description', ''),
      ...(typeof e?.isDeferred === 'boolean' ? { isDeferred: e.isDeferred } : {}),
    }),
  },
  command: {
    describe: (e: Event) => ({
      description: field(e, 'description', ''),
      ...(typeof e?.argumentHint === 'string' ? { argumentHint: e.argumentHint } : {}),
      isHidden: e?.isHidden === true,
    }),
  },
  prompt: {
    section: (e: Event) => ({ text: field(e, 'text', null) }),
    context: (e: Event) => ({ blocks: field(e, 'blocks', []) }),
    attachment: (e: Event) => ({ text: field(e, 'text', null) }),
  },
  skill: { prompt: (e: Event) => ({ text: field(e, 'text', '') }) },
  attribution: { text: (e: Event) => ({ text: field(e, 'text', '') }) },
  agent: { offer: () => ({ isOffered: true }) },
}

export function createEventCalls(host: () => ModsHost) {
  return {
    /** `$.ui.invalidate(event)`: the event's kept answers go, and clients re-read the mods. */
    invalidate: (event: unknown) => host().invalidate(event),
    /**
     * `$.prompt.compose`: the conversation's system prompt as the engine composes it, from what
     * its latest turn composed it from, each fact the call names in place of the turn's.
     */
    async compose(scene: ModScene, args: unknown) {
      const conversation = host().conversations.of(scene.sessionId)
      const facts = conversation?.composed as ComposeFacts | undefined
      if (!conversation || !facts)
        throw new Error('prompt.compose: no system prompt was composed in this conversation yet')
      const model = fieldOf(args, 'model')
      const scope = { host: host(), scene: conversation.scene, plugins: conversation.plugins }
      return {
        sections: await coreSections(scope, {
          ...facts,
          ...(typeof model === 'string' && model ? { model } : {}),
        }),
      }
    },
    /**
     * `$.session.compact`: a checkpoint of the conversation, taken as its next turn starts (the
     * hooks have had their say on this call); resolves to the conversation as it reads now.
     */
    async compact(scene: ModScene) {
      if (!scene.sessionId) return { skip: 'No conversation to compact' }
      host().conversations.requestCompaction(scene.sessionId)
      const session = await host().ports.readSession?.(scene)
      return { messages: session?.messages ?? [] }
    },
  }
}

export type ModEventCalls = ReturnType<typeof createEventCalls>
