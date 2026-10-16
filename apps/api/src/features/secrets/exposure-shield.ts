import type { AgentToolResult } from '@localixai/agent/agents'

const REDACTED = '[vault-secret]'
const MAX_VALUES_PER_USER = 256

/**
 * Below this length, removing every occurrence of a value does more harm than the exposure it
 * prevents, so the value is not registered at all.
 *
 * Measured against this shield: `ollama` — what a local-provider setup actually puts in the
 * required key field — turned `curl http://localhost:11434/api/tags # ollama` into
 * `… # [vault-secret]`; `local` rewrote `cd /Users/x/local/project`; `none` rewrote a commit
 * message; a single space rewrote EVERY space in the text. Provider fields validate as
 * `z.string().min(1)`, so all of those are reachable input.
 *
 * The blast radius is wider than the transcript. A shielded tool input is replayed to the model
 * as its own `tool_call.arguments` on the next run, so a five-character "secret" corrupts the
 * conversation the model reasons over, and a plugin-config value flows through the same shield.
 *
 * The floor is on LENGTH, not character classes, because length is what predicts an accidental
 * collision: a genuine all-lowercase passphrase of 25 characters will not appear in a transcript
 * unless it actually leaked, while `password` and `postgres` will — and a class rule would refuse
 * to protect the passphrase. The cost is stated plainly: a credential shorter than this is NOT
 * redacted. At that length the values users store are placeholders for providers that require no
 * auth, and protecting them is not worth corrupting every surface that renders text.
 */
const MIN_REDACTABLE_LENGTH = 12

/** Long enough that erasing every occurrence of it cannot damage ordinary text. */
export function isRedactableSecret(value: string): boolean {
  return value.trim().length >= MIN_REDACTABLE_LENGTH
}

/**
 * Last-line protection for model-facing tool results.
 *
 * A trusted adapter necessarily sees a resolved credential while it performs the
 * authorized operation. An upstream service can still reflect that credential in
 * a response or error. Remembering resolved values lets the runtime remove exact
 * plaintext (plus common wire encodings) before any tool result reaches the model.
 *
 * This is defense in depth, not authorization: values are bounded, process-local,
 * never persisted, never logged and scoped by Vault owner.
 */
export interface SecretExposureShield {
  remember(userId: string, value: string): void
  redactText(userId: string, value: string): string
  redactResult(userId: string, result: AgentToolResult): AgentToolResult
  redactError(userId: string, error: unknown): unknown
  /**
   * Any structured value on its way to a client, the transcript or a log — a tool call's ARGUMENTS
   * and its streaming progress details.
   *
   * Results and errors were shielded from the start while arguments never were, and the
   * consequence was that a `bash` invocation carrying an inline credential
   * (`PGPASSWORD=… psql`, `curl -H "X-Api-Key: …"`) is persisted verbatim into `agent_messages`
   * and streamed to every connected client. Same for `onUpdate` details, which fire BEFORE the
   * result boundary.
   *
   * Deliberately NOT applied to what a tool EXECUTES with: redacting there would break the command.
   *
   * It is NOT, however, "presentation only", as this said before a review corrected it. The
   * persisted item is the source the next run's wire messages are built from
   * (`itemsToWireMessages` emits `arguments: item.input`), so the model sees the redacted form of
   * its OWN earlier call, and a background job's label — read back by the `jobs` tool — comes from
   * the shielded copy too. Nothing re-EXECUTES from it, so this cannot break a command; but it is
   * why {@link MIN_REDACTABLE_LENGTH} matters, and why the traversal bounds in
   * {@link redactUnknown} are set to be unreachable for real payloads — every one of them
   * substitutes a string for a structure the model already sent.
   */
  redactValue(userId: string, value: unknown): unknown
}

const variantsOf = (value: string): string[] => {
  const variants = new Set([value])
  try {
    variants.add(encodeURIComponent(value))
  } catch {
    // An invalid surrogate is still protected in its raw form.
  }
  variants.add(Buffer.from(value).toString('base64'))
  return [...variants].filter(Boolean).sort((left, right) => right.length - left.length)
}

/**
 * Traversal has to be BOUNDED — a cyclic object recurses forever — but every bound it hits
 * substitutes a string for a structure, and this output is not presentation-only: the shielded copy
 * is persisted and `itemsToWireMessages` rebuilds the next run's `tool_call.arguments` from it, so a
 * substitution changes the type of an argument the model already sent. The bounds below are
 * therefore set to be unreachable for real payloads, and each guards a distinct hazard:
 *
 * - `MAX_DEPTH` bounds STACK growth. It replaced a bare `depth >= 8`, which was inside the range of
 *   ordinary data: MCP and plugin tool inputs are shaped by their providers, and a Kubernetes manifest reaches
 *   `spec.template.spec.containers[].env[].valueFrom.secretKeyRef` at depth 9. At the cap the
 *   credential branch was not redacted but DELETED, shape and all.
 * - `MAX_NODES` bounds WORK. The old cap did this by accident (2^8 traversals); a raised depth limit
 *   without it turns a 40-level doubling DAG into 2^40 visits, and `event.details` / a HITL payload
 *   are host- and plugin-constructed objects that can share references, not fresh JSON.
 * - The path set bounds CYCLES. It tracks the current path, not every object seen, or a payload that
 *   mentions one object twice — a DAG, entirely ordinary — would have its second mention dropped.
 *   Without it a self-referencing object expanded into `MAX_DEPTH` duplicated copies of itself,
 *   persisted and streamed to every client.
 */
const MAX_DEPTH = 64
const MAX_NODES = 20_000
const TRUNCATED = '[truncated]'
/** A cycle has no faithful representation, so this marker is the honest answer, not a fallback. */
const CYCLE = '[cycle]'

const redactUnknown = (value: unknown, redact: (text: string) => string): unknown => {
  const path = new Set<object>()
  let budget = MAX_NODES

  const walk = (input: unknown, depth: number): unknown => {
    if (typeof input === 'string') return redact(input)
    if (input === null || typeof input !== 'object') return input
    if (path.has(input)) return CYCLE
    if (depth >= MAX_DEPTH || budget <= 0) return TRUNCATED
    budget--
    if (Array.isArray(input)) {
      path.add(input)
      try {
        return input.map((entry) => walk(entry, depth + 1))
      } finally {
        path.delete(input)
      }
    }
    const proto = Object.getPrototypeOf(input)
    if (proto !== Object.prototype && proto !== null) return input
    path.add(input)
    try {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, entry]) => [
          key,
          walk(entry, depth + 1),
        ]),
      )
    } finally {
      path.delete(input)
    }
  }

  return walk(value, 0)
}

export function createSecretExposureShield(): SecretExposureShield {
  const byUser = new Map<string, string[]>()

  const remember = (userId: string, value: string) => {
    // The gate lives HERE, not at the call sites: three of them exist (plugin config,
    // `resolveSecret`, provider credentials) and a fourth would otherwise have to remember.
    if (!isRedactableSecret(value)) return
    const current = byUser.get(userId) ?? []
    const variants = variantsOf(value)
    const variantSet = new Set(variants)
    const next = [...variants, ...current.filter((entry) => !variantSet.has(entry))]
    byUser.set(userId, next.slice(0, MAX_VALUES_PER_USER))
  }

  const redactText = (userId: string, value: string): string => {
    let output = value
    for (const secret of byUser.get(userId) ?? []) {
      output = output.split(secret).join(REDACTED)
    }
    return output
  }

  return {
    remember,
    redactText,
    redactResult(userId, result) {
      const redact = (value: string) => redactText(userId, value)
      return redactUnknown(result, redact) as AgentToolResult
    },
    redactValue(userId, value) {
      return redactUnknown(value, (text) => redactText(userId, text))
    },
    redactError(userId, error) {
      if (error instanceof Error) {
        const safe = new Error(redactText(userId, error.message))
        safe.name = error.name
        return safe
      }
      return typeof error === 'string' ? redactText(userId, error) : error
    },
  }
}
