/** Render a request twice: a safe observable view and the secret-resolved wire view. */

import type { EnvironmentService } from './environments/service'
import { renderSpec, type RenderedSpec } from './render-spec'
import type { RequestSpec } from './request-spec'
import { resolvedSecretValues } from './response-redaction'
import { hasSecretTokens } from '@localixai/mini-app-sdk/backend'

export interface EnvironmentRender {
  /** Safe for UI, history and model output: vault references remain references. */
  safe: RenderedSpec
  /** Used only by the network sender: environment vault references are resolved. */
  wire: RenderedSpec
  /** Literal substitutions that must be scrubbed if an upstream reflects them back. */
  secretValues: string[]
}

export async function renderEnvironmentForSend(
  spec: RequestSpec,
  environments: EnvironmentService,
  userId: string,
  requestName?: string,
): Promise<EnvironmentRender> {
  const [safeVars, wireVars] = await Promise.all([
    environments.activeVars(userId),
    environments.activeVars(userId, { resolveSecrets: true, requestName }),
  ])
  const secretValues = new Set<string>()
  for (const [name, safeValue] of safeVars) {
    if (!hasSecretTokens(safeValue)) continue
    const wireValue = wireVars.get(name)
    if (wireValue === undefined) continue
    for (const value of resolvedSecretValues(safeValue, wireValue)) secretValues.add(value)
  }
  const safe = renderSpec(spec, safeVars)
  const wire = renderSpec(spec, wireVars)
  return { safe, wire, secretValues: [...secretValues] }
}
