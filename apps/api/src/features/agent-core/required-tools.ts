import { evaluate, type PermissionRule } from './permission-engine'
import { resourceOnlyCall } from './permission-facts'

export interface ToolRequirement {
  name: string
  /** Each resource is a separately required operation, using the tool's native resource vocabulary. */
  resources?: readonly string[]
}

/**
 * Check the assembled dispatch roster, including deferred tools. A host requirement
 * must fail closed when a tool disappears; it must never restore filtered tools.
 * Required operations also pass the same scoped capability evaluator as live calls.
 *
 * A DENY always stops preparation: the answer will not change during the run, so starting
 * one only to fail it later costs the whole run.
 *
 * An ASK depends on whether anyone can answer it, which is exactly what `interactive` says.
 * Unattended, an ask IS a refusal — a board worker that may not report its outcome has no way
 * to finish — so preparation refuses in its place, early and cheaply. In a conversation the
 * same ask is an ordinary confirmation that belongs at the moment of the call, where the
 * person can see what is being asked; refusing to START turns a perfectly ordinary "ask me
 * about everything" rule into an agent that cannot answer hello, and says so in the
 * vocabulary of an internal recovery operation the user never named.
 */
export function assertRequiredToolsAvailable(
  required: readonly ToolRequirement[] | undefined,
  tools: readonly { name: string }[],
  rules: readonly PermissionRule[] = [],
  /** Can a human answer a prompt from this run? See `hitl-reachable.ts`. */
  interactive = false,
): void {
  if (!required?.length) return
  const available = new Set(tools.map((tool) => tool.name))
  const missing = [...new Set(required.map((requirement) => requirement.name))].filter(
    (name) => !available.has(name),
  )
  if (missing.length) {
    throw new Error(`Required run tools are unavailable: ${missing.join(', ')}`)
  }
  for (const requirement of required) {
    for (const resource of new Set(requirement.resources ?? [])) {
      const decision = evaluate(
        rules,
        // No call exists yet — only the resource it will name — so nothing about the call's
        // effect is known; judged as a read, as it was before calls carried a class.
        { name: requirement.name, effect: 'read' },
        resourceOnlyCall([resource]),
      )
      if (decision.action === 'deny') {
        throw new Error(
          `Required run operation ${requirement.name}(${resource}) is denied by policy`,
        )
      }
      if (decision.action === 'ask' && !interactive) {
        throw new Error(
          `Required run operation ${requirement.name}(${resource}) requires approval, and this run cannot reach anyone to give it`,
        )
      }
    }
  }
}
