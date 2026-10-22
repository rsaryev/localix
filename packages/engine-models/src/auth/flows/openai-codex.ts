/**
 * ChatGPT Plus/Pro through the Codex backend: the Codex CLI's sign-in, in a browser or with a
 * device code. Its callback ports (1455, then 1457) are shared with the Codex CLI, so a port an
 * older attempt still holds is asked to give way through its `/cancel` route first.
 */
import type { RuntimeOAuthCredential } from '@localixai/agent/runtime'

import { cancellableSleep, pollDeviceCode } from '../device-code'
import {
  askToFreePort,
  callbackOrPasted,
  generatePkce,
  parsePastedAuthorization,
  randomToken,
  startCallbackServer,
  type CallbackServer,
} from '../loopback'
import { signInFetch, tokenJson, type OAuthFlow } from './types'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH = 'https://auth.openai.com'
const TOKEN_URL = `${AUTH}/oauth/token`
const PORTS = [1455, 1457]
const CALLBACK_PATH = '/auth/callback'
const CANCEL_PATH = '/cancel'
const DEVICE_VERIFICATION_URI = `${AUTH}/codex/device`
const DEVICE_REDIRECT_URI = `${AUTH}/deviceauth/callback`
const DEVICE_TIMEOUT_SECONDS = 15 * 60
const SCOPE = 'openid profile email offline_access'
const ACCOUNT_CLAIM = 'https://api.openai.com/auth'

/** The ChatGPT account a token belongs to, which every Codex request names. */
function accountIdOf(accessToken: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, { chatgpt_account_id?: unknown }>
    const accountId = payload[ACCOUNT_CLAIM]?.chatgpt_account_id
    if (typeof accountId === 'string' && accountId) return accountId
  } catch {
    // Not a JWT we can read.
  }
  throw new Error('The ChatGPT token names no account')
}

/** Without a stated lifetime a token is taken to last an hour, as the Codex CLI does. */
const DEFAULT_LIFETIME_SECONDS = 3_600

/**
 * One token request. A refresh may leave out a new refresh token (the old one stays valid) or the
 * lifetime, as the Codex CLI accepts; only the access token is required.
 */
async function token(
  body: Record<string, string>,
  signal: AbortSignal,
  operation: string,
  previous?: RuntimeOAuthCredential,
): Promise<RuntimeOAuthCredential> {
  const response = await signInFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal,
  })
  const json = await tokenJson(response, 'OpenAI Codex', operation)
  const refreshToken =
    typeof json.refresh_token === 'string' && json.refresh_token
      ? json.refresh_token
      : previous?.refreshToken
  if (typeof json.access_token !== 'string' || !json.access_token || !refreshToken)
    throw new Error('OpenAI Codex sent an incomplete token response')
  const lifetime =
    typeof json.expires_in === 'number' && json.expires_in > 0
      ? json.expires_in
      : DEFAULT_LIFETIME_SECONDS
  return {
    type: 'oauth',
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + lifetime * 1_000,
    extra: { ...previous?.extra, accountId: accountIdOf(json.access_token) },
  }
}

const exchange = (code: string, verifier: string, redirectUri: string, signal: AbortSignal) =>
  token(
    {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    },
    signal,
    'exchange',
  )

async function listen(
  state: string,
  signal: AbortSignal,
): Promise<CallbackServer<string> | undefined> {
  for (const port of PORTS) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- binding is retried in order on purpose
        return await startCallbackServer({
          providerName: 'OpenAI',
          host: '127.0.0.1',
          port,
          path: CALLBACK_PATH,
          cancel: {
            path: CANCEL_PATH,
            message: 'Login cancelled by a newer ChatGPT login attempt',
          },
          state,
          complete: async (params) => params.get('code')!,
          signal,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') return undefined
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- binding is retried in order on purpose
        if (attempt === 0) await askToFreePort(port, CANCEL_PATH)
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- binding is retried in order on purpose
        await cancellableSleep(200, signal)
      }
    }
  }
  return undefined
}

async function browserLogin(
  context: Parameters<OAuthFlow['login']>[0],
): Promise<RuntimeOAuthCredential> {
  const { interaction, signal, agentName } = context
  const state = randomToken(16)
  const callback = await listen(state, signal)
  const redirectUri = callback?.redirectUri ?? `http://127.0.0.1:${PORTS[0]}${CALLBACK_PATH}`
  const { verifier, challenge } = await generatePkce()
  const url = new URL(`${AUTH}/oauth/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: agentName,
  }).toString()
  await interaction.notify({
    type: 'auth-url',
    url: url.toString(),
    instructions: 'Sign in to OpenAI in the browser window that opens.',
  })
  try {
    const result = await callbackOrPasted(interaction, callback, {
      message:
        'Complete login in your browser, or paste the authorization code / redirect URL here:',
      placeholder: redirectUri,
    })
    let code: string | undefined
    if (result.type === 'callback') code = result.value
    else {
      const pasted = parsePastedAuthorization(result.input)
      if (pasted.state && pasted.state !== state) throw new Error('State mismatch')
      code = pasted.code
    }
    if (!code) throw new Error('The redirect carried no authorization code')
    return await exchange(code, verifier, redirectUri, signal)
  } finally {
    callback?.close()
  }
}

async function deviceLogin({
  interaction,
  signal,
}: Parameters<OAuthFlow['login']>[0]): Promise<RuntimeOAuthCredential> {
  const start = await signInFetch(`${AUTH}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal,
  })
  if (!start.ok)
    throw new Error(
      start.status === 404
        ? 'Device-code login is not enabled; use browser login.'
        : `Device-code request failed (${start.status})`,
    )
  const device = (await start.json()) as {
    device_auth_id?: string
    user_code?: string
    interval?: number | string
  }
  const intervalSeconds = Number(device.interval)
  if (!device.device_auth_id || !device.user_code || !Number.isFinite(intervalSeconds))
    throw new Error('Invalid device-code response')
  await interaction.notify({
    type: 'device-code',
    userCode: device.user_code,
    verificationUri: DEVICE_VERIFICATION_URI,
    intervalSeconds,
    expiresInSeconds: DEVICE_TIMEOUT_SECONDS,
  })
  const granted = await pollDeviceCode<{ code: string; verifier: string }>({
    intervalSeconds,
    expiresInSeconds: DEVICE_TIMEOUT_SECONDS,
    signal,
    poll: async () => {
      const response = await signInFetch(`${AUTH}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          device_auth_id: device.device_auth_id,
          user_code: device.user_code,
        }),
        signal,
      })
      if (response.ok) {
        const json = (await response.json()) as {
          authorization_code?: string
          code_verifier?: string
        }
        return json.authorization_code && json.code_verifier
          ? {
              status: 'complete',
              value: { code: json.authorization_code, verifier: json.code_verifier },
            }
          : { status: 'failed', message: 'Invalid device-code token response' }
      }
      if (response.status === 403 || response.status === 404) return { status: 'pending' }
      const text = await response.text().catch(() => '')
      if (text.includes('deviceauth_authorization_pending')) return { status: 'pending' }
      if (text.includes('slow_down')) return { status: 'slow_down' }
      return {
        status: 'failed',
        message: `Device sign-in failed (${response.status})${text ? `: ${text}` : ''}`,
      }
    },
  })
  return exchange(granted.code, granted.verifier, DEVICE_REDIRECT_URI, signal)
}

export const openAICodexFlow: OAuthFlow = {
  async login(context) {
    const method = await context.interaction.prompt({
      type: 'select',
      message: 'Select the ChatGPT login method:',
      options: [
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ],
      signal: context.signal,
    })
    return method === 'device_code' ? deviceLogin(context) : browserLogin(context)
  },
  refresh: (credential, signal) =>
    token(
      { grant_type: 'refresh_token', refresh_token: credential.refreshToken, client_id: CLIENT_ID },
      signal,
      'refresh',
      credential,
    ),
  access: (credential, request) => {
    const accountId = credential.extra?.accountId
    return {
      apiKey: credential.accessToken,
      headers: {
        originator: 'localix',
        ...(typeof accountId === 'string' ? { 'chatgpt-account-id': accountId } : {}),
        // ChatGPT routes its prompt cache on this header.
        ...(request.sessionId ? { 'session-id': request.sessionId } : {}),
      },
    }
  },
}
