/**
 * The importer contract. Pure: an importer turns text into requests, and knows nothing about the
 * store, the tool, or the network.
 *
 * A chain of importers is tried in order and each answers `null` for a payload that isn't its
 * format, so adding a format is adding one module to one list — no sniffing logic in the caller.
 */

import type { RequestSpec } from '../request-spec'
import type { EnvironmentVariable } from '../collection/environments'

export interface ImportedRequest {
  /** A suggested save name. The caller decides whether to use it — names collide. */
  name: string
  spec: RequestSpec
}

/**
 * Caller-supplied facts an importer cannot read out of the payload.
 *
 * There is exactly one so far, and it earns its place: an OpenAPI spec may declare a RELATIVE
 * server (`url: /api/v3` — the real Swagger Petstore does), which the spec defines as relative to
 * wherever the document was served from. We were handed pasted text, so that origin is genuinely
 * unknowable here — it is not a parsing gap, it is information that isn't in the document.
 */
export interface ImportOptions {
  /** Origin (or origin + prefix) to resolve a relative server against, e.g. `https://api.dev`. */
  baseUrl?: string
}

/**
 * An environment a source carries — `{{variables}}` requests render against.
 *
 * The contract carries these because two formats are MOSTLY environments and one is NOTHING else:
 * a Postman environment export has no requests at all, and `runImport` claims a source only when
 * an importer returns requests — so without this it fell through the whole chain and came back
 * "format not recognised". Describing an environment in prose ("recreate it with {…}") would leave
 * a person to retype what we had already parsed.
 */
export interface ImportedEnvironment {
  name: string
  variables: EnvironmentVariable[]
}

export interface Importer {
  /** Stable id, e.g. `curl`. Reported so a user knows which format was recognised. */
  id: string
  /** Human name for the format, e.g. `cURL command`. */
  name: string
  /**
   * Parse `text`, or return null when it isn't this format.
   *
   * MUST NOT throw on malformed input — a throw would abort the whole chain and deny every later
   * importer its turn. Returning null means "not mine"; returning [] means "mine, but empty".
   */
  convert(text: string, options?: ImportOptions): ImportedRequest[] | null
  /**
   * Environments this source carries, for a payload this importer CLAIMED.
   *
   * Only called when `convert` did not return null, so it may assume the format. A source with
   * environments and no requests is a legitimate import — see `ImportedEnvironment`.
   */
  environments?(text: string, options?: ImportOptions): ImportedEnvironment[]
  /**
   * Things this format carries that we cannot, for a payload this importer just CLAIMED.
   *
   * Optional, and only Postman implements it so far — because only Postman has a feature we
   * silently cannot honour. A request that imports looking perfectly well-formed and then sends a
   * literal `{{$randomInt}}` is the failure worth spending a contract on; "we dropped a file body"
   * is the same class. An importer with nothing to admit simply omits this.
   */
  notes?(text: string): string[]
}
