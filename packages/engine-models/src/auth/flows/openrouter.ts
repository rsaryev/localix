/**
 * OpenRouter's PKCE sign-in. It ends with a permanent API key the person controls rather than an
 * expiring token pair, so the credential never needs refreshing.
 */
import {
  callbackOrPasted,
  generatePkce,
  parsePastedAuthorization,
  startCallbackServer,
} from '../loopback'
import { signInFetch, tokenJson, type OAuthFlow } from './types'

const AUTHORIZE_URL = 'https://openrouter.ai/auth'
const KEY_URL = 'https://openrouter.ai/api/v1/auth/keys'
const LOGIN_TIMEOUT_MS = 5 * 60_000

async function exchange(code: string, verifier: string, signal: AbortSignal) {
  const response = await signInFetch(KEY_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  })
  const body = await tokenJson(response, 'OpenRouter', 'exchange')
  if (typeof body.key !== 'string' || !body.key) throw new Error('OpenRouter sent no API key')
  return {
    type: 'oauth' as const,
    accessToken: body.key,
    refreshToken: '',
    expiresAt: Number.MAX_SAFE_INTEGER,
  }
}

export const openRouterFlow: OAuthFlow = {
  async login({ interaction, signal }) {
    const { verifier, challenge } = await generatePkce()
    // OpenRouter sends no `state`; a random path keeps stray requests from completing the sign-in.
    const callback = await startCallbackServer({
      providerName: 'OpenRouter',
      host: '127.0.0.1',
      port: 0,
      path: `/oauth/callback/${crypto.randomUUID()}`,
      complete: (params) => exchange(params.get('code')!, verifier, signal),
      signal,
      timeoutMs: LOGIN_TIMEOUT_MS,
    })
    try {
      const url = new URL(AUTHORIZE_URL)
      url.search = new URLSearchParams({
        callback_url: callback.redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()
      await interaction.notify({
        type: 'auth-url',
        url: url.toString(),
        instructions:
          'Sign in to OpenRouter in the browser. If the browser runs on another machine, paste the address it ends on here.',
      })
      const result = await callbackOrPasted(interaction, callback, {
        message:
          'Complete sign-in in your browser, or paste the authorization code / redirect URL here:',
        placeholder: callback.redirectUri,
      })
      if (result.type === 'callback') return result.value
      const { code } = parsePastedAuthorization(result.input)
      if (!code) throw new Error('The redirect carried no authorization code')
      await interaction.notify({
        type: 'progress',
        message: 'Exchanging the authorization code for an API key…',
      })
      return await exchange(code, verifier, signal)
    } finally {
      callback.close()
    }
  },
  refresh: async (credential) => credential,
  access: (credential) => ({ apiKey: credential.accessToken }),
}
