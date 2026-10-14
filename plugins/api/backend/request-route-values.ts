import type { RequestInfo, ResolvedPreview, RestErrorResponse } from './contracts'
import type { CollectionRequest } from './collection/store'
import type { EnvironmentService } from './environments/service'
import { toErrorInfo, mapRestError } from './errors'
import { redactSpec } from './store'
import { hasTemplate } from './template'
import { renderSpec } from './render-spec'

/**
 * The 404 bodies.
 *
 * `error` is the sentence a surface puts on its line; `code` is the classification a caller
 * branches on. Both fields used to carry the CODE, so a person whose request had been renamed
 * elsewhere read the words `request_not_found` on the sidebar — the same defect the Database
 * workbench shipped and fixed.
 */
export const REQUEST_NOT_FOUND = {
  error: 'No saved request by that name.',
  code: 'request_not_found' as const,
}
/** Serialize any thrown value into the typed `{ error, code, detail }` body. */
export function restErrorBody(err: unknown): RestErrorResponse {
  const info = toErrorInfo(mapRestError(err))
  return { error: info.message, code: info.code, detail: info.detail }
}

/**
 * What a request resolves to right now, or undefined when it uses no variables.
 *
 * Computed on the READ, not cached: the active environment changes under a tab that is already
 * open, and a preview that went stale would say the request points somewhere it no longer does —
 * which is exactly the confusion environments exist to remove.
 */
export async function resolvedFor(
  environments: EnvironmentService,
  userId: string,
  saved: CollectionRequest,
): Promise<ResolvedPreview | undefined> {
  if (!hasTemplate(saved.spec.url)) return undefined
  const rendered = renderSpec(saved.spec, await environments.activeVars(userId))
  return {
    url: rendered.spec.url,
    missing: rendered.missing,
    environment: await environments.activeName(userId),
  }
}

/** The wire view of a stored record — redacted, always. */
export function toInfo(saved: CollectionRequest): RequestInfo {
  return {
    name: saved.name,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    spec: redactSpec(saved.spec),
  }
}
