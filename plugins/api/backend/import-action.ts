/**
 * The `import` action: pasted text → previewed, or saved, requests.
 *
 * Import DEFAULTS TO A PREVIEW. A HAR from a browser tab can hold hundreds of requests, and an
 * import that silently wrote all of them would bury the handful the user meant among the analytics
 * beacons. `save: true` is the second step, taken once the model has seen what it got.
 */

import type { RequestSpec } from './request-spec'
import { formatImportPreview, formatSavedImport, type ImportReport } from './import-report'
import type { CollectionStore } from './collection/store'
import { importerNames, runImport } from './import/registry'
import type { ImportedRequest } from './import/types'
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
 * Import one or more payloads as ONE operation.
 *
 * `sources` is a list because a directory of exported files is a list, and running the whole
 * action per file would report "Imported 1 request" forty times — forty blocks of near-identical
 * prose for what the user experienced as one import. The CHAIN still runs per payload (each file
 * is its own document), but naming, vaulting, saving and reporting happen once over the union, so
 * dedup sees the whole batch and the answer reads as one thing that happened.
 */
export async function runImportAction(
  deps: ImportDeps,
  sources: string | readonly string[],
  save: boolean,
  options?: { baseUrl?: string },
): Promise<ImportReport | { ok: false; problem: string; message: string }> {
  const payloads = typeof sources === 'string' ? [sources] : sources
  const outcomes = payloads.map((text) => runImport(text, options)).filter((o) => o !== null)
  if (outcomes.length === 0) {
    const message =
      `Could not recognise that as any format we import (${importerNames()}). ` +
      'Paste a cURL command verbatim, e.g. `curl -H "Accept: application/json" https://api.github.com/users/octocat`, ' +
      'or a HAR 1.2 archive.'
    // The person has the sidebar's own editor; only the agent is pointed at the tool call.
    return {
      ok: false,
      problem: `${message} To build a request by hand instead, use {"action":"save",…}.`,
      message,
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

  if (!save) return formatImportPreview(outcome, named, plural)

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

  return formatSavedImport({
    outcome,
    named,
    plural,
    refused,
    saved,
    savedEnvs,
    refusedEnvs,
    vaulted,
    stranded,
  })
}
