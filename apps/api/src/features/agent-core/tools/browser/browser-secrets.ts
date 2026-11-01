import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'
import type { AgentToolResult } from '@localixai/agent/agents'
import type { ResolvedInput } from './browser-input'

/**
 * Vault references in the `browser` tool: the agent types a stored credential into a page without
 * ever reading it.
 *
 * A `type` step's text may be, or contain, `${secret:KEY}` (the grammar monitors and plugin configs
 * already use, driven by the SDK's own resolver). The host resolves it for THAT value only, right
 * before the relay, so the model-facing input, the approval prompt and the transcript all carry
 * the reference. Whatever comes back — snapshot, field values, console, errors — passes through
 * the exposure shield, which removes the value wherever the page echoes it.
 *
 * A reference anywhere else (a selector, an `evaluate` expression, a `select` option, `goal`
 * values) is NOT resolved: those fields can run code or leave the page, and the model would get
 * the value back through the page. The result says so instead of silently typing the literal.
 */
export interface BrowserSecrets {
  /** The value of one vault key for this user, registered with the shield; absent if unknown. */
  resolve(key: string): Promise<string | undefined>
  /** The exposure shield over any structured value on its way to the model. */
  redact(value: unknown): unknown
}

type Step = NonNullable<ResolvedInput['steps']>[number]

/** The only place a reference is honoured. */
const isTyping = (step: Step) => step.action === 'type' && typeof step.text === 'string'

const UNRESOLVED_NOTE =
  '[A ${secret:KEY} reference outside a "type" step\'s text was not resolved and was sent as written. References work only in typed text.]'

export type PreparedSecrets =
  | {
      ok: true
      input: ResolvedInput
      typedSecret: boolean
      shield: <T extends AgentToolResult>(result: T) => T
    }
  | { ok: false; error: string }

/** Appends the not-resolved note when a reference sits anywhere but a typing step's text. */
export function withUnresolvedNote(content: string, input: ResolvedInput): string {
  return hasUnresolvableReference(input) ? `${content}\n\n${UNRESOLVED_NOTE}` : content
}

function hasUnresolvableReference(input: ResolvedInput): boolean {
  const stripped = {
    ...input,
    steps: input.steps?.map((step) => (isTyping(step) ? { ...step, text: '' } : step)),
  }
  return hasSecretTokens(JSON.stringify(stripped))
}

export async function prepareSecretSteps(
  input: ResolvedInput,
  secrets: BrowserSecrets | undefined,
): Promise<PreparedSecrets> {
  const steps = input.steps
  const typed = steps?.some((step) => isTyping(step) && hasSecretTokens(step.text!))
  if (!steps || !typed) return { ok: true, input, typedSecret: false, shield: (result) => result }
  if (!secrets)
    return {
      ok: false,
      error:
        'This step types a stored secret, but the vault is unavailable in this run. Nothing was typed.',
    }
  const missing = new Set<string>()
  const resolved = await Promise.all(
    steps.map(async (step) => {
      if (!isTyping(step) || !hasSecretTokens(step.text!)) return step
      const text = await resolveSecretTokens(step.text!, async (key) => {
        const value = await secrets.resolve(key)
        if (value === undefined || value === '') {
          missing.add(key)
          return ''
        }
        return value
      })
      return { ...step, text }
    }),
  )
  if (missing.size > 0)
    return {
      ok: false,
      error: `Not in the vault: ${[...missing].join(', ')}. Create it (\`Vault\` action:"create") or fix the \${secret:KEY} reference — nothing was typed.`,
    }
  return {
    ok: true,
    input: { ...input, steps: resolved },
    typedSecret: true,
    shield: (result) => secrets.redact(result) as typeof result,
  }
}
