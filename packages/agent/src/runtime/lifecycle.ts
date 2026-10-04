import { z } from 'zod'

/** Events describe native control points; formats translate their own event names into these. */
export const lifecycleEventSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_.:-]*$/),
  gate: z.enum(['observe', 'tool', 'input', 'completion']),
})
export type LifecycleEventDefinition = Readonly<z.infer<typeof lifecycleEventSchema>>

export const BUILTIN_LIFECYCLE_EVENTS = [
  { id: 'session.start', gate: 'observe' },
  { id: 'input.submit', gate: 'input' },
  { id: 'tool.before', gate: 'tool' },
  { id: 'tool.after', gate: 'observe' },
  { id: 'run.finish', gate: 'completion' },
  { id: 'session.end', gate: 'observe' },
  { id: 'delegation.start', gate: 'observe' },
  { id: 'delegation.finish', gate: 'completion' },
  // A context checkpoint is deterministic and already durable when it is announced, so a
  // check can observe it but not cancel it.
  { id: 'context.checkpoint.before', gate: 'observe' },
  { id: 'attention.request', gate: 'observe' },
] as const satisfies readonly LifecycleEventDefinition[]
export type BuiltinLifecycleEventId = (typeof BUILTIN_LIFECYCLE_EVENTS)[number]['id']

export interface LifecycleGateResult {
  accepted: boolean
  reason?: string
}

/** Approval by a lifecycle check never grants tool authority; Capabilities decides that. */
export type LifecycleGateEffect =
  | { kind: 'none' }
  | { kind: 'deny-tool' | 'reject-input' | 'continue-run'; reason?: string }

export function resolveLifecycleGate(
  event: LifecycleEventDefinition,
  result: LifecycleGateResult,
): LifecycleGateEffect {
  if (result.accepted || event.gate === 'observe') return { kind: 'none' }
  switch (event.gate) {
    case 'tool':
      return { kind: 'deny-tool', reason: result.reason }
    case 'input':
      return { kind: 'reject-input', reason: result.reason }
    case 'completion':
      return { kind: 'continue-run', reason: result.reason }
  }
}

/** Hosts can add control points without adopting a foreign event vocabulary in the core. */
export function createLifecycleEventRegistry() {
  const events = new Map<string, LifecycleEventDefinition>(
    BUILTIN_LIFECYCLE_EVENTS.map((event) => [event.id, Object.freeze({ ...event })]),
  )
  return {
    register(input: LifecycleEventDefinition): () => void {
      const event = Object.freeze(lifecycleEventSchema.parse(input))
      if (events.has(event.id)) throw new Error(`Lifecycle event already registered: ${event.id}`)
      events.set(event.id, event)
      return () => {
        if (events.get(event.id) === event) events.delete(event.id)
      }
    },
    get(id: string): LifecycleEventDefinition | undefined {
      return events.get(id)
    },
    list(): readonly LifecycleEventDefinition[] {
      return [...events.values()]
    },
  }
}
