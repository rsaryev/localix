/**
 * A monitor's command may name a vault key; it must never contain its VALUE.
 *
 * The problem this solves. A wait against an authenticated API is the common case
 * (`curl -H "Authorization: Bearer …"`), and every way of writing it before this module
 * leaked the credential somewhere durable: pasted into the command it lands in the tool
 * call's persisted input, in the composer strip, in the confirm card and in the model's
 * context; taken from `$SOME_TOKEN` it only works if the user keeps secrets in their shell
 * profile, which is the arrangement the vault exists to replace.
 *
 * So the command carries a REFERENCE — the same `${secret:KEY}` grammar plugin configs and
 * saved API requests already use — and the value reaches the process through its
 * ENVIRONMENT, never through text:
 *
 *   stored / shown / gated:  curl -H "Authorization: Bearer ${secret:MSGR_TOKEN}" …
 *   executed:                curl -H "Authorization: Bearer $LOCALIX_SECRET_MSGR_TOKEN" …
 *   env of that process:     LOCALIX_SECRET_MSGR_TOKEN=<value>
 *
 * Why the env and not the resolved string: a command's arguments are visible to every local
 * process through `ps aux`, while the environment of a process is readable only by its owner.
 * The substitution is also what keeps the value out of everything we persist — nothing here
 * ever returns a string containing the secret.
 *
 * ONE grammar, deliberately: rather than re-declaring the token regex, this drives the SDK's
 * own `resolveSecretTokens` and resolves each token to an env-var REFERENCE instead of a
 * value. A change to the grammar therefore cannot leave this module reading the old one.
 */
import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'

/** Env-var prefix for an injected vault value. Namespaced so it cannot shadow a real var. */
export const SECRET_ENV_PREFIX = 'LOCALIX_SECRET_'

/**
 * Env-var name for a vault key. Vault keys allow `.` and `-` (see `SECRET_KEY_PATTERN`),
 * which a shell cannot name, so they fold to `_` — and the mapping is applied to the command
 * and the env from the same function, so the two cannot disagree.
 */
export function secretEnvName(key: string): string {
  return `${SECRET_ENV_PREFIX}${key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
}

export interface SecretSubstitution {
  /** The command with every `${secret:KEY}` replaced by `$LOCALIX_SECRET_KEY`. */
  command: string
  /** The vault keys it referenced, in first-seen order. */
  keys: string[]
}

/**
 * Rewrite `${secret:KEY}` → `$LOCALIX_SECRET_KEY` and report the keys. Resolves nothing:
 * no value is read here, so this half stays testable without a vault.
 */
export async function substituteSecretEnv(command: string): Promise<SecretSubstitution> {
  if (!hasSecretTokens(command)) return { command, keys: [] }
  const keys: string[] = []
  const rewritten = await resolveSecretTokens(command, async (key) => {
    if (!keys.includes(key)) keys.push(key)
    return `$${secretEnvName(key)}`
  })
  return { command: rewritten, keys }
}

export type SecretResolution =
  | { ok: true; env: Record<string, string> }
  | { ok: false; missing: string[] }

export type SecretPreflight =
  | { ok: true; executable: string; keys: string[]; env: Record<string, string> }
  | { ok: false; error: string }

/**
 * The whole credential step of a start, in one call: rewrite the references, apply the policy
 * a secret-bearing command is subject to, and resolve the values. Every refusal happens HERE,
 * before anything is spawned — a monitor that starts without its credential polls a 401 for
 * its whole timeout and reports nothing, which is indistinguishable from still waiting.
 *
 * Lives beside the substitution rather than in the service so the service stays the registry:
 * this is the credential concern end to end, and it is testable without a registry at all.
 */
export async function prepareSecrets(input: {
  /** The command as written, with `${secret:KEY}` references intact. */
  command: string
  /** True for a `watch` with no deadline — the one shape a secret may not be used in. */
  persistentWatch: boolean
  /** Absent ⇒ this run has no vault, so a command that needs one is refused. */
  resolve?: (key: string) => Promise<string | undefined>
}): Promise<SecretPreflight> {
  const { command: executable, keys } = await substituteSecretEnv(input.command)
  if (keys.length === 0) return { ok: true, executable, keys, env: {} }

  // A `watch` holds the environment it was spawned with for as long as its process lives, so an
  // unbounded one would keep a credential resident for the whole session with no moment at
  // which a rotation or revocation takes effect. A polled check re-reads its env every
  // interval, so `until` is free of that and may stay persistent.
  if (input.persistentWatch) {
    return {
      ok: false,
      error: `A persistent \`watch\` cannot use a stored secret (${keys.join(', ')}): its process would hold the value for the whole session. Give it a timeout_ms, or use \`until\`, which re-reads the secret on every poll.`,
    }
  }
  if (!input.resolve) {
    return {
      ok: false,
      error: `This monitor references stored secrets (${keys.join(', ')}) but the vault is unavailable in this run.`,
    }
  }
  const resolved = await resolveSecretEnv(keys, input.resolve)
  if (!resolved.ok) {
    return {
      ok: false,
      error: `Not in the vault: ${resolved.missing.join(', ')}. Create it (\`Vault\` action:"create") or fix the \${secret:KEY} reference — the monitor was not started.`,
    }
  }
  return { ok: true, executable, keys, env: resolved.env }
}

/**
 * Resolve the referenced keys into the env the process will get. A MISSING key fails the whole
 * start: a monitor that polls with an empty credential watches nothing and reports nothing —
 * the failure mode this feature must never have — so the caller refuses at start and names the
 * key, which is something the model can act on (`vault action:"create"`).
 */
export async function resolveSecretEnv(
  keys: readonly string[],
  resolve: (key: string) => Promise<string | undefined>,
): Promise<SecretResolution> {
  const env: Record<string, string> = {}
  const missing: string[] = []
  for (const key of keys) {
    const value = await resolve(key)
    if (value === undefined || value === '') missing.push(key)
    else env[secretEnvName(key)] = value
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, env }
}
