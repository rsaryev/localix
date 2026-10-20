/**
 * Sign in with ChatGPT for the OpenAI API: a public-client flow whose access token goes straight
 * to api.openai.com, billed to the person's ChatGPT plan. Every login registers its own client;
 * OpenAI returns the issued client id in the redirect and refreshes require it.
 *
 * Ported from pi (github.com/earendil-works/pi, MIT, © Mario Zechner).
 */
import type { RuntimeOAuthCredential } from '@localixai/agent/runtime'

import { callbackOrPasted, generatePkce, randomToken, startCallbackServer } from '../loopback'
import { signInFetch, tokenJson, type OAuthFlow } from './types'

const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
const RESOURCE = 'https://api.openai.com/v1'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
const DIRECT_TOKEN_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_TOKEN_SCOPE}`
/** Refresh this long before expiry, so no request starts with a token about to lapse. */
const EXPIRY_MARGIN_MS = 3 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

async function requestToken(body: URLSearchParams, signal: AbortSignal) {
  const response = await signInFetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  })
  return tokenJson(
    response,
    'OpenAI',
    body.get('grant_type') === 'refresh_token' ? 'refresh' : 'exchange',
  )
}

function credentialFrom(token: Record<string, unknown>, clientId: string): RuntimeOAuthCredential {
  const { access_token: access, refresh_token: refresh, scope, expires_in: expiresIn } = token
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof scope !== 'string') {
    throw new Error('OpenAI sent an incomplete token response')
  }
  if (typeof expiresIn !== 'number' || !(expiresIn > 0))
    throw new Error('OpenAI sent no token lifetime')
  const scopes = scope.trim().split(/\s+/u).filter(Boolean)
  if (!scopes.includes(DIRECT_TOKEN_SCOPE))
    throw new Error(`OpenAI did not grant ${DIRECT_TOKEN_SCOPE}`)
  return {
    type: 'oauth',
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + expiresIn * 1_000 - EXPIRY_MARGIN_MS,
    extra: { clientId, scopes },
  }
}

function fromRedirect(params: URLSearchParams, state: string): { code: string; clientId: string } {
  const error = params.get('error')
  if (error) throw new Error(`ChatGPT authorization failed: ${error}`)
  const code = params.get('code')
  if (!code) throw new Error('Missing authorization code')
  if (params.get('state') !== state) throw new Error('OAuth state mismatch')
  const clientId = params.get('client_id')?.trim()
  if (!clientId) throw new Error('OpenAI did not return the client id it issued')
  return { code, clientId }
}

export const openAIChatGPTFlow: OAuthFlow = {
  async login({ interaction, signal, agentName, getDeviceId }) {
    const deviceId = getDeviceId?.()
    if (!deviceId || !UUID.test(deviceId))
      throw new Error('Sign in with ChatGPT needs a device id (UUID) for this installation')
    const { verifier, challenge } = await generatePkce()
    const state = randomToken()
    const callback = await startCallbackServer({
      providerName: 'ChatGPT',
      host: '127.0.0.1',
      port: CALLBACK_PORT,
      path: CALLBACK_PATH,
      state,
      complete: async (params) => fromRedirect(params, state),
      signal,
    }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw error
      throw new Error(
        `Port ${CALLBACK_PORT} is in use, probably by an unfinished login or by the Codex CLI. Cancel that login and try again.`,
      )
    })
    try {
      const url = new URL(AUTHORIZE_URL)
      url.search = new URLSearchParams({
        client_id: DYNAMIC_CLIENT_ID,
        agent_name_hint: agentName,
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        resource: RESOURCE,
        scope: SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        nonce: randomToken(),
      }).toString()
      await interaction.notify({
        type: 'auth-url',
        url: url.toString(),
        instructions:
          'Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.',
      })
      const result = await callbackOrPasted(interaction, callback, {
        message: 'Complete login in your browser, or paste the final redirect URL here:',
        placeholder: REDIRECT_URI,
      })
      let redirect: { code: string; clientId: string }
      if (result.type === 'callback') redirect = result.value
      else {
        let pasted: URL
        try {
          pasted = new URL(result.input.trim())
        } catch {
          throw new Error('Paste the full callback URL from the browser')
        }
        redirect = fromRedirect(pasted.searchParams, state)
      }
      await interaction.notify({
        type: 'progress',
        message: 'Exchanging the authorization code for tokens…',
      })
      const token = await requestToken(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: redirect.clientId,
          code: redirect.code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
          resource: RESOURCE,
        }),
        signal,
      )
      if (typeof token.id_token !== 'string' || !token.id_token)
        throw new Error('OpenAI sent no ID token')
      return credentialFrom(token, redirect.clientId)
    } finally {
      callback.close()
    }
  },

  async refresh(credential, signal) {
    const clientId = credential.extra?.clientId
    if (typeof clientId !== 'string' || !clientId.trim())
      throw new Error('This ChatGPT sign-in has no client id; sign in again')
    const token = await requestToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: credential.refreshToken,
        resource: RESOURCE,
      }),
      signal,
    )
    return credentialFrom(token, clientId)
  },

  access: (credential) => ({ apiKey: credential.accessToken }),
}
