import { fauxProvider } from '@earendil-works/pi-ai'
import type { AgentEvent } from '@localixai/agent/agents'

import { createPiAgentRuntime } from '../runtime'
import type { PiModelMiddleware } from '../middleware'

/**
 * A run of the assembled runtime driven by a SCRIPT instead of a provider.
 *
 * Keyless, because the middleware seam is a full substitute for the provider: a middleware that
 * answers from a script instead of calling `doStreamSimple` never reaches the network, and pi's own
 * faux provider emits the event sequence a real one would rather than a hand-rolled approximation.
 */
export function scripted(
  responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
) {
  const faux = fauxProvider()
  faux.setResponses(responses)
  const middleware: PiModelMiddleware = {
    // Deliberately does NOT call `doStreamSimple`: the script IS the provider here.
    wrapStreamSimple: async ({ params }) =>
      faux.provider.streamSimple(faux.getModel(), params.context, params.options),
  }
  return { middleware, callCount: () => faux.state.callCount }
}

export async function collect(input: Record<string, unknown> & { middleware: PiModelMiddleware }) {
  const { middleware, ...rest } = input
  const run = createPiAgentRuntime().run({ ...rest, middleware: [middleware] } as never)
  const events: AgentEvent[] = []
  for await (const event of run) events.push(event)
  return { events, result: await run.result }
}

export const scriptedBaseInput = {
  sessionId: 'scripted-run',
  systemPrompt: 'be brief',
  messages: [{ role: 'user' as const, content: 'go' }],
  // A real catalog pair, because model resolution is a gate the run passes before it streams.
  // No key is ever used: the middleware answers from the script instead of calling through.
  model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  credential: { type: 'api-key' as const, key: 'unused' },
}
