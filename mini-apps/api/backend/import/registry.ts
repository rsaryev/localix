/**
 * The importer chain. Adding a format is adding one module to IMPORTERS — no caller changes, no
 * sniffing logic outside the importers themselves.
 *
 * Order matters only for ambiguity, and cheapest-sniff-first is the tiebreak: curl rejects a
 * non-curl string with one regex, while HAR must JSON.parse the whole payload to know. The importers
 * are paste-driven and the common input is a one-line curl.
 */

import { curlImporter } from './curl'
import { localixImporter } from './localix'
import { harImporter } from './har'
import { insomniaImporter } from './insomnia'
import { openApiImporter } from './openapi'
import { swagger2Importer } from './swagger2'
import { postmanImporter } from './postman'
import { postmanEnvImporter } from './postman-env'
import type { ImportedEnvironment, ImportedRequest, Importer, ImportOptions } from './types'

/**
 * Cheapest sniff first, most-certain first. Our own file leads: one JSON parse plus one property,
 * and nothing else can claim it. Then curl (one regex). Then HAR (parse + one property), then
 * OpenAPI, which may fall through to a YAML parse. None of them can collide — a HAR has
 * `log.entries`, a spec has `openapi`, a Postman collection has `info.schema`, an Insomnia export
 * has `__export_format`, ours has `localixRestRequest`, and a curl command is not JSON at all.
 */
export const IMPORTERS: readonly Importer[] = [
  localixImporter,
  curlImporter,
  harImporter,
  insomniaImporter,
  postmanEnvImporter,
  postmanImporter,
  openApiImporter,
  swagger2Importer,
]

export interface ImportOutcome {
  importer: Importer
  requests: ImportedRequest[]
  /** What the format carries and we do not — see `Importer.notes`. */
  notes: string[]
  /** Environments the source carries. May be non-empty while `requests` is empty. */
  environments: ImportedEnvironment[]
}

/**
 * Try each importer until one claims the payload. Returns null when none does.
 *
 * A throwing importer is treated as "not mine" rather than allowed to abort the chain: a
 * malformed payload of format A must still get format B's turn, and an importer's own bug must
 * not make every other format unusable.
 */
export function runImport(
  text: string,
  options?: ImportOptions,
  /**
   * The chain to try. Defaults to the real one; a SEAM so a test can lead with a broken importer
   * and exercise THIS function's guard rather than a copy of it. (Its first test re-implemented the
   * try/catch in the test body, so deleting the real one would not have failed anything.)
   */
  importers: readonly Importer[] = IMPORTERS,
): ImportOutcome | null {
  for (const importer of importers) {
    let requests: ImportedRequest[] | null = null
    try {
      requests = importer.convert(text, options)
    } catch {
      continue
    }
    if (!requests) continue // null means "not mine"

    // A `notes`/`environments` that throws must not lose an import that already succeeded.
    let notes: string[] = []
    try {
      notes = importer.notes?.(text) ?? []
    } catch {
      notes = []
    }
    let environments: ImportedEnvironment[] = []
    try {
      environments = importer.environments?.(text, options) ?? []
    } catch {
      environments = []
    }

    // Claimed when it yielded ANYTHING. Requests alone used to be the test, which made a Postman
    // ENVIRONMENT export — a file with no requests in it, by definition — fall through the entire
    // chain and come back "format not recognised". An import that produces only environments is a
    // real import.
    //
    // Still not a match when it yielded nothing at all: a document that is OpenAPI-shaped but
    // describes nothing should let the chain keep looking rather than report a successful import
    // of zero of everything.
    if (requests.length > 0 || environments.length > 0) {
      return { importer, requests, notes, environments }
    }
  }
  return null
}

/** The formats we recognise, for a fix-it message. */
export function importerNames(): string {
  return IMPORTERS.map((i) => i.name).join(', ')
}
