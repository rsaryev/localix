import { describeRequest } from './request-summary'
import { isPlaceholderHost } from './import/openapi/server'
import type { ImportedEnvironment, ImportedRequest } from './import/types'

interface ImportReportSource {
  importer: { name: string }
  notes: readonly string[]
  environments: readonly ImportedEnvironment[]
}

interface SavedImportReport {
  outcome: ImportReportSource
  named: readonly ImportedRequest[]
  plural: string
  refused: readonly string[]
  saved: readonly ImportedRequest[]
  savedEnvs: readonly string[]
  refusedEnvs: readonly string[]
  vaulted: readonly string[]
  stranded: readonly string[]
}

function preview(requests: readonly ImportedRequest[]): string {
  return requests.map(({ name, spec }) => describeRequest({ name, spec })).join('\n')
}

/**
 * A note when the import landed on the placeholder host — i.e. the spec declared a RELATIVE server
 * and could not say where it lives.
 *
 * This must be LOUD rather than left for the user to notice. The requests look completely normal;
 * only the hostname is invented, and the first sign otherwise is a confusing failure against a
 * domain nobody recognises. With an inlined url the honest answer is saying so.
 */
function placeholderNote(specs: readonly { spec: { url: string } }[]): string | null {
  const affected = specs.filter(({ spec }) => isPlaceholderHost(spec.url)).length
  if (affected === 0) return null
  return (
    `The spec declares a RELATIVE server, so it never says which host it lives on — ` +
    `${affected === specs.length ? 'every request uses' : `${affected} request(s) use`} the placeholder ` +
    '`https://example.com` and will NOT work as imported. Re-run the import with the real origin, e.g. ' +
    '{"action":"import","source":…,"baseUrl":"https://petstore3.swagger.io","save":true}.'
  )
}

/**
 * Vault keys an import REFERENCED but did not create — the user must add them before sending.
 *
 * `created` is excluded because those keys were minted moments ago from a literal we actually had
 * (see `vaultLiteralAuth`), so they resolve. What is left are the keys an OpenAPI spec DESCRIBED:
 * a spec states that an endpoint needs a bearer token, and cannot state the token. Those are the
 * only ones a person has to go and fill in.
 */
function danglingKeyNote(
  specs: readonly { spec: { auth: unknown } }[],
  created: ReadonlySet<string>,
): string | null {
  const keys = new Set<string>()
  for (const { spec } of specs) {
    const auth = spec.auth as Record<string, unknown>
    for (const value of Object.values(auth)) {
      if (typeof value !== 'string') continue
      for (const m of value.matchAll(/\$\{secret:([A-Za-z0-9_.-]+)\}/g)) {
        if (!created.has(m[1])) keys.add(m[1])
      }
    }
  }
  if (keys.size === 0) return null
  return (
    `The spec describes auth but cannot contain the credential, so ${keys.size === 1 ? 'the request references' : 'requests reference'} ` +
    `${[...keys].map((k) => `\`${k}\``).join(', ')} in the secrets vault. Add ${keys.size === 1 ? 'that key' : 'those keys'} in ` +
    'Settings → Secrets; until then a send fails with "Secret not found", naming the key.'
  )
}

/** `2 environments` / `an environment` — for a one-line summary. */
function environmentSummary(environments: readonly ImportedEnvironment[]): string {
  return environments.length === 1
    ? `the environment "${environments[0].name}"`
    : `${environments.length} environments`
}

/** Preview environments without ever echoing an imported secret literal to the model. */
function environmentPreview(environments: readonly ImportedEnvironment[]): string {
  return environments
    .map(
      (env) =>
        `${env.name}: ${env.variables
          .map(
            (v) =>
              `${v.name}=${v.secret ? '<vault secret>' : v.value}${v.disabled ? ' (off)' : ''}`,
          )
          .join(', ')}`,
    )
    .join('\n')
}

/**
 * An import's report, twice: `content` for the agent, with the tool call that continues it, and
 * `message` for the person in the sidebar, who continues it with a button instead. Both are built
 * from the same paragraphs, so the person's copy is never a string surgery on the agent's.
 */
export interface ImportReport {
  ok: true
  content: string
  message: string
}

function report(paragraphs: ReadonlyArray<string | { agentOnly: string }>): ImportReport {
  const join = (forAgent: boolean) =>
    paragraphs
      .map((p) => (typeof p === 'string' ? p : forAgent ? p.agentOnly : ''))
      .filter(Boolean)
      .join('\n\n')
  return { ok: true, content: join(true), message: join(false) }
}

/** Report a preview without writing any imported data. */
export function formatImportPreview(
  outcome: ImportReportSource,
  named: readonly ImportedRequest[],
  plural: string,
): ImportReport {
  const warn = placeholderNote(named)
  const what = [
    named.length > 0 ? `${named.length} ${plural}` : '',
    outcome.environments.length > 0 ? environmentSummary(outcome.environments) : '',
  ].filter(Boolean)
  return report([
    `Recognised ${outcome.importer.name}${what.length > 0 ? ` — ${what.join(' and ')}` : ''}. Not saved yet.`,
    named.length > 0 ? preview(named) : '',
    environmentPreview(outcome.environments),
    { agentOnly: 'Re-run with {"action":"import","source":…,"save":true} to store these.' },
    warn ?? '',
    ...outcome.notes,
  ])
}

/** Describe completed writes and refusals using the records that actually reached storage. */
export function formatSavedImport({
  outcome,
  named,
  plural,
  refused,
  saved,
  savedEnvs,
  refusedEnvs,
  vaulted,
  stranded,
}: SavedImportReport): ImportReport {
  const notes: string[] = []
  // A refusal is the LOUDEST thing an import can produce, so it goes first. Session JSON rejects a
  // literal credential outright; without a vault writer bound there is nowhere safe for that
  // credential to go, and the request genuinely cannot be saved.
  if (refused.length > 0) {
    notes.push(
      `${refused.length} request(s) could NOT be saved:\n  ${refused.join('\n  ')}\n` +
        'Saved request JSON never persists literal credentials. ' +
        'Store it in the vault and reference it as ${secret:KEY}.',
    )
  }
  if (savedEnvs.length > 0) {
    notes.push(
      `Saved ${savedEnvs.map((n) => `"${n}"`).join(', ')} as ${savedEnvs.length === 1 ? 'an environment' : 'environments'}. ` +
        `NOT activated — activate with {"action":"use","target":"environment","name":"${savedEnvs[0]}"} on the api_client tool ` +
        'when you want requests to render against it.',
    )
  } else if (outcome.environments.length > 0 && refusedEnvs.length === 0) {
    // The host bound no environment service. Say so rather than dropping them on the floor.
    notes.push(
      `This source carries ${environmentSummary(outcome.environments)}, which could not be saved here. ` +
        `Recreate with {"action":"save","target":"environment","name":"${outcome.environments[0].name}","variables":${JSON.stringify(
          outcome.environments[0].variables.map((v) => ({ name: v.name, value: v.value })),
        )}} on the api_client tool.`,
    )
  }
  if (refusedEnvs.length > 0) {
    notes.push(
      `${refusedEnvs.length} environment(s) could NOT be saved:\n  ${refusedEnvs.join('\n  ')}\n` +
        'A secret environment value is never allowed to fall back to plaintext.',
    )
  }
  if (vaulted.length > 0) {
    notes.push(
      `Moved ${vaulted.length === 1 ? 'a credential' : `${vaulted.length} credentials`} into the secrets vault — ` +
        `the saved request${named.length === 1 ? '' : 's'} now reference${named.length === 1 ? 's' : ''} ` +
        `${vaulted.map((k) => `\`\${secret:${k}}\``).join(', ')} instead of holding the value.`,
    )
  }
  if (stranded.length > 0) {
    notes.push(
      `A credential on ${stranded.map((n) => `"${n}"`).join(', ')} could NOT be vaulted and is stored as written. ` +
        'Replace it with a `${secret:KEY}` reference once the key exists.',
    )
  }
  // Computed from what was actually WRITTEN, not from what we tried to write: a refused record
  // is not on disk, and a note describing it as saved would be a lie the user acts on.
  const dangling = danglingKeyNote(saved, new Set(vaulted))
  for (const note of [placeholderNote(saved), dangling, ...outcome.notes])
    if (note) notes.push(note)

  // Preview the RECORDS, not the parsed requests: after vaulting they are what is actually
  // stored, and previewing the pre-vault specs would report a state that no longer exists.
  // A Postman ENVIRONMENT export has no requests in it, by definition — so nothing below may
  // assume `named[0]` exists. It used to: `named[0].name` would have thrown on the first such
  // import, turning a working feature into a crash.
  const what = [
    named.length > 0 ? `${named.length} ${plural}` : '',
    savedEnvs.length > 0 ? environmentSummary(outcome.environments) : '',
  ].filter(Boolean)
  return report([
    `Imported ${what.join(' and ') || 'nothing'} from ${outcome.importer.name}.`,
    named.length > 0 ? preview(saved) : '',
    named.length > 0
      ? { agentOnly: `Send one with {"action":"send","name":"${named[0].name}"}.` }
      : '',
    ...notes,
  ])
}
