/**
 * The `import` action: pasted text → previewed, or saved, requests.
 *
 * Import DEFAULTS TO A PREVIEW. A HAR from a browser tab can hold hundreds of requests, and an
 * import that silently wrote all of them would bury the handful the user meant among the analytics
 * beacons. `save: true` is the second step, taken once the model has seen what it got.
 */

import { redactSpec } from './store'
import type { RequestSpec } from './request-spec'
import type { CollectionStore } from './collection/store'
import { importerNames, runImport } from './import/registry'
import { isPlaceholderHost } from './import/openapi/server'
import type { ImportedEnvironment, ImportedRequest } from './import/types'
import type { EnvironmentService } from './environments/service'
import { authNeedsVault } from './secrets'
import { vaultLiteralAuth, type StoreSecret } from './vault-auth'

/** True when the auth already points at the vault rather than carrying a value. */
const authIsReference = authNeedsVault

/**
 * Make every name unique against the store AND against the rest of the batch. A HAR hits the same
 * endpoint repeatedly, so `api-users`, `api-users-2`, `api-users-3` is the normal case, not an
 * edge case — and silently overwriting would collapse the batch to its last request.
 */
export async function uniqueNames(
  store: CollectionStore,
  requests: readonly ImportedRequest[],
): Promise<ImportedRequest[]> {
  const taken = new Set((await store.list()).map((r) => r.name))
  return requests.map(({ name, spec }) => {
    let candidate = name
    for (let n = 2; taken.has(candidate); n++) candidate = `${name}-${n}`
    taken.add(candidate)
    return { name: candidate, spec }
  })
}

function preview(requests: readonly ImportedRequest[]): string {
  return requests
    .map(({ name, spec }) => {
      const s = redactSpec(spec)
      const auth = s.auth.type === 'none' ? '' : ` [auth: ${s.auth.type}]`
      return `${name}: ${s.method} ${s.url}${auth}`
    })
    .join('\n')
}

export interface ImportDeps {
  store: CollectionStore
  userId: string
  /** Absent when no host bound the vault writer — the literal then stays put, and we say so. */
  storeSecret?: StoreSecret
  /**
   * Where an imported environment is written. Optional so `runImport`'s other callers need not
   * grow a dependency they have no use for; absent means an environment is reported and not saved,
   * which is honest rather than silent.
   */
  environments?: Pick<EnvironmentService, 'save'>
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

/**
 * Import one or more payloads as ONE operation.
 *
 * `sources` is a list because a directory of exported files is a list, and running the whole
 * action per file would report "Imported 1 request" forty times — forty blocks of near-identical
 * prose for what the user experienced as one import. The CHAIN still runs per payload (each file
 * is its own document), but naming, vaulting, saving and reporting happen once over the union, so
 * dedup sees the whole batch and the answer reads as one thing that happened.
 */
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

export async function runImportAction(
  deps: ImportDeps,
  sources: string | readonly string[],
  save: boolean,
  options?: { baseUrl?: string },
): Promise<{ ok: true; content: string } | { ok: false; problem: string }> {
  const payloads = typeof sources === 'string' ? [sources] : sources
  const outcomes = payloads.map((text) => runImport(text, options)).filter((o) => o !== null)
  if (outcomes.length === 0) {
    return {
      ok: false,
      problem:
        `Could not recognise that as any format we import (${importerNames()}). ` +
        'Paste a cURL command verbatim, e.g. `curl -H "Accept: application/json" https://api.github.com/users/octocat`, ' +
        'or a HAR 1.2 archive. To build a request by hand instead, use {"action":"save",…}.',
    }
  }
  // One label when every payload was the same format (the normal case: a directory of our files,
  // or a single paste); otherwise say so rather than picking one arbitrarily.
  const formats = [...new Set(outcomes.map((o) => o.importer.name))]
  const outcome = {
    importer: { name: formats.length === 1 ? formats[0] : formats.join(' + ') },
    requests: outcomes.flatMap((o) => o.requests),
    // Deduped across payloads: importing a directory of collections that each use `{{$guid}}`
    // should say so once, not once per file.
    notes: [...new Set(outcomes.flatMap((o) => o.notes))],
    environments: outcomes.flatMap((o) => o.environments),
  }

  const named = await uniqueNames(deps.store, outcome.requests)
  const plural = named.length === 1 ? 'request' : 'requests'

  if (!save) {
    const warn = placeholderNote(named)
    const what = [
      named.length > 0 ? `${named.length} ${plural}` : '',
      outcome.environments.length > 0 ? environmentSummary(outcome.environments) : '',
    ].filter(Boolean)
    return {
      ok: true,
      content:
        `Recognised ${outcome.importer.name}${what.length > 0 ? ` — ${what.join(' and ')}` : ''}. Not saved yet.\n\n` +
        [named.length > 0 ? preview(named) : '', environmentPreview(outcome.environments)]
          .filter(Boolean)
          .join('\n\n') +
        '\n\nRe-run with {"action":"import","source":…,"save":true} to store these.' +
        [warn, ...outcome.notes]
          .filter(Boolean)
          .map((n) => `\n\n${n}`)
          .join(''),
    }
  }

  // Vault every literal credential BEFORE anything is written: the plaintext must never reach the
  // collection at all, not even briefly. A stored-then-vaulted order would leave the secret in a
  // file on disk between the two writes, and a crash in that window leaves it there for good.
  // The collection REFUSES a literal outright, so this ordering is now load-bearing twice over:
  // an unvaulted credential does not merely linger, it fails the save.
  const vaulted: string[] = []
  const stranded: string[] = []
  const records: Array<{ name: string; spec: RequestSpec }> = []
  for (const { name, spec } of named) {
    const { auth, key } = await vaultLiteralAuth(deps.userId, name, spec.auth, deps.storeSecret)
    if (key) vaulted.push(key)
    // Nothing moved, but there WAS something to move — the literal is still in `auth`.
    else if (spec.auth.type !== 'none' && !authIsReference(spec.auth)) stranded.push(name)
    records.push({ name, spec: { ...spec, auth } })
  }
  const refused: string[] = []
  const saved: Array<{ name: string; spec: RequestSpec }> = []
  for (const record of records) {
    const written = await deps.store.save(record.name, record.spec)
    if (written.ok) saved.push({ name: written.request.name, spec: written.request.spec })
    else refused.push(`"${record.name}": ${written.problem}`)
  }

  // Environments are written but NOT activated. Importing is not choosing: a person importing a
  // Postman export mid-task should not have the request they are about to send silently re-pointed
  // at whatever host the import happened to carry.
  const savedEnvs: string[] = []
  const refusedEnvs: string[] = []
  for (const env of outcome.environments) {
    if (!deps.environments) break
    try {
      await deps.environments.save(deps.userId, env.name, env.variables)
      savedEnvs.push(env.name)
    } catch (error) {
      refusedEnvs.push(
        `"${env.name}": ${error instanceof Error ? error.message : 'could not be saved'}`,
      )
    }
  }

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
  return {
    ok: true,
    content:
      `Imported ${what.join(' and ') || 'nothing'} from ${outcome.importer.name}.` +
      (named.length > 0
        ? `\n\n${preview(saved)}\n\nSend one with {"action":"send","name":"${named[0].name}"}.`
        : '') +
      (notes.length > 0 ? `\n\n${notes.join('\n\n')}` : ''),
  }
}
