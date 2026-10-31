import type { RuntimeAuthInteraction, RuntimeOAuthCredential } from '@localixai/agent/runtime'

import type { ProviderAccess } from '../../providers/connect'

interface FlowContext {
  interaction: RuntimeAuthInteraction
  /** Signal of the whole sign-in; never undefined inside a flow. */
  signal: AbortSignal
  /** How this application names itself to the provider (`Localix`). */
  agentName: string
  /** A stable UUID for this installation, where a provider asks for one. */
  getDeviceId?: () => string | undefined
}

/** One provider's sign-in: get a credential, keep it fresh, and turn it into request access. */
export interface OAuthFlow {
  login(context: FlowContext): Promise<RuntimeOAuthCredential>
  /** A fresh credential from a stale one. Keeps every provider field the next refresh needs. */
  refresh(credential: RuntimeOAuthCredential, signal: AbortSignal): Promise<RuntimeOAuthCredential>
  /** How a request reaches the provider with this credential. */
  access(credential: RuntimeOAuthCredential, request: { sessionId?: string }): ProviderAccess
}

/** A token endpoint's JSON, or its error as a sentence that names the provider. */
export async function tokenJson(
  response: Response,
  provider: string,
  operation: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `${provider} token ${operation} failed (${response.status}): ${body || response.statusText}`,
    )
  }
  const json: unknown = await response.json()
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new Error(`${provider} token ${operation} returned no object`)
  return json as Record<string, unknown>
}

/** Turn a network abort during sign-in into the sentence a person expects. */
export async function signInFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (init.signal?.aborted) throw new Error('Login cancelled')
    throw error
  }
}
