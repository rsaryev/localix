/**
 * GitHub Copilot: a device-code sign-in to GitHub (github.com or an Enterprise domain), whose token
 * is exchanged for a short-lived Copilot token. The Copilot token names its own API host
 * (`proxy-ep`), and models that need a policy switched on are enabled at sign-in.
 *
 * Ported from pi (github.com/earendil-works/pi, MIT, © Mario Zechner).
 */
import type { RuntimeOAuthCredential } from '@localixai/agent/runtime'

import { pollDeviceCode } from '../device-code'
import { signInFetch, type OAuthFlow } from './types'

/** One model of Copilot's `/models` listing, as far as availability reads it. */
interface CopilotModelRow {
  id?: unknown
  model_picker_enabled?: unknown
  policy?: { state?: unknown }
  capabilities?: { supports?: { tool_calls?: unknown } }
}

const CLIENT_ID = atob('SXYxLmI1MDdhMDhjODdlY2ZlOTg=')
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const
const API_VERSION = '2026-06-01'

function normalizeDomain(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return undefined
  }
}

/** The API host a Copilot token names (`proxy-ep=proxy.x` → `https://api.x`). */
function apiBaseOf(copilotToken: string, enterprise: string | undefined): string {
  const proxy = /proxy-ep=([^;]+)/u.exec(copilotToken)?.[1]
  if (proxy) return `https://${proxy.replace(/^proxy\./u, 'api.')}`
  return enterprise
    ? `https://copilot-api.${enterprise}`
    : 'https://api.individual.githubcopilot.com'
}

async function json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await signInFetch(url, init)
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status}: ${await response.text().catch(() => '')}`)
  return (await response.json()) as Record<string, unknown>
}

async function copilotToken(
  githubToken: string,
  enterprise: string | undefined,
  signal: AbortSignal,
): Promise<RuntimeOAuthCredential> {
  const body = await json(`https://api.${enterprise ?? 'github.com'}/copilot_internal/v2/token`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${githubToken}`,
      ...COPILOT_HEADERS,
    },
    signal,
  })
  if (typeof body.token !== 'string' || typeof body.expires_at !== 'number')
    throw new Error('GitHub sent no Copilot token')
  return {
    type: 'oauth',
    accessToken: body.token,
    refreshToken: githubToken,
    // Five minutes early: a request must never start with a token about to lapse.
    expiresAt: body.expires_at * 1_000 - 5 * 60_000,
    extra: enterprise ? { enterpriseUrl: enterprise } : {},
  }
}

/** The account's models: those it may use now, and those waiting for their policy to be enabled. */
async function accountModels(token: string, enterprise: string | undefined, signal: AbortSignal) {
  const base = apiBaseOf(token, enterprise)
  const body = await json(`${base}/models`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...COPILOT_HEADERS,
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  })
  const rows = Array.isArray(body.data) ? (body.data as CopilotModelRow[]) : []
  const usable = rows.filter(
    (row) => typeof row.id === 'string' && row.capabilities?.supports?.tool_calls !== false,
  )
  const picker = usable
    .filter((row) => row.model_picker_enabled === true && row.policy?.state !== 'disabled')
    .map((row) => row.id as string)
  // Some individual accounts flag nothing for the picker despite enabled policies.
  const fallback = picker.length === 0 && base === 'https://api.individual.githubcopilot.com'
  const available = fallback
    ? usable.filter((row) => row.policy?.state === 'enabled').map((row) => row.id as string)
    : picker
  const unconfigured = usable
    .filter(
      (row) =>
        row.policy?.state === 'unconfigured' && (row.model_picker_enabled === true || fallback),
    )
    .map((row) => row.id as string)
  return { base, available, unconfigured }
}

async function enablePolicies(
  token: string,
  base: string,
  ids: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const enabled: string[] = []
  for (const id of ids) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- policies are enabled one at a time to respect GitHub's rate limit
    const response = await signInFetch(`${base}/models/${id}/policy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...COPILOT_HEADERS,
        'openai-intent': 'chat-policy',
        'x-interaction-type': 'chat-policy',
      },
      body: JSON.stringify({ state: 'enabled' }),
      signal,
    }).catch(() => undefined)
    if (response?.status === 429) break
    if (response?.ok) enabled.push(id)
  }
  return enabled
}

/** A field of GitHub's answer as text, whatever JSON it is. */
const textOf = (value: unknown) =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)

const enterpriseOf = (credential: RuntimeOAuthCredential) =>
  typeof credential.extra?.enterpriseUrl === 'string'
    ? normalizeDomain(credential.extra.enterpriseUrl)
    : undefined

export const gitHubCopilotFlow: OAuthFlow = {
  async login({ interaction, signal }) {
    const input = await interaction.prompt({
      type: 'text',
      message: 'GitHub Enterprise URL/domain (blank for github.com)',
      placeholder: 'company.ghe.com',
      signal,
    })
    const enterprise = normalizeDomain(input)
    if (input.trim() && !enterprise) throw new Error('Invalid GitHub Enterprise URL/domain')
    const domain = enterprise ?? 'github.com'
    const device = await json(`https://${domain}/login/device/code`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': COPILOT_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: 'read:user' }),
      signal,
    })
    const {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: uri,
      interval,
      expires_in: expiresIn,
    } = device
    if (
      typeof deviceCode !== 'string' ||
      typeof userCode !== 'string' ||
      typeof uri !== 'string' ||
      typeof expiresIn !== 'number'
    ) {
      throw new Error('Invalid device-code response')
    }
    // Opened in a browser: it must be a web address, never something an OS would execute.
    const verification = new URL(uri)
    if (verification.protocol !== 'https:' && verification.protocol !== 'http:')
      throw new Error('Untrusted verification URL')
    await interaction.notify({
      type: 'device-code',
      userCode,
      verificationUri: verification.href,
      ...(typeof interval === 'number' ? { intervalSeconds: interval } : {}),
      expiresInSeconds: expiresIn,
    })
    const githubToken = await pollDeviceCode<string>({
      ...(typeof interval === 'number' ? { intervalSeconds: interval } : {}),
      expiresInSeconds: expiresIn,
      waitBeforeFirstPoll: true,
      signal,
      poll: async () => {
        const body = await json(`https://${domain}/login/oauth/access_token`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'User-Agent': COPILOT_HEADERS['User-Agent'],
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          signal,
        })
        if (typeof body.access_token === 'string')
          return { status: 'complete', value: body.access_token }
        if (body.error === 'authorization_pending') return { status: 'pending' }
        if (body.error === 'slow_down')
          return {
            status: 'slow_down',
            ...(typeof body.interval === 'number' ? { intervalSeconds: body.interval } : {}),
          }
        return {
          status: 'failed',
          message: `Device sign-in failed: ${textOf(body.error) || 'unknown'}${body.error_description ? `: ${textOf(body.error_description)}` : ''}`,
        }
      },
    })
    const credential = await copilotToken(githubToken, enterprise, signal)
    const models = await accountModels(credential.accessToken, enterprise, signal).catch(
      () => undefined,
    )
    if (!models) return credential
    if (models.unconfigured.length > 0)
      await interaction.notify({ type: 'progress', message: 'Enabling models…' })
    const enabled = await enablePolicies(
      credential.accessToken,
      models.base,
      models.unconfigured,
      signal,
    )
    return {
      ...credential,
      extra: {
        ...credential.extra,
        availableModelIds: [...new Set([...models.available, ...enabled])],
      },
    }
  },

  async refresh(credential, signal) {
    const enterprise = enterpriseOf(credential)
    const fresh = await copilotToken(credential.refreshToken, enterprise, signal)
    const models = await accountModels(fresh.accessToken, enterprise, signal).catch(() => undefined)
    return {
      ...fresh,
      extra: { ...fresh.extra, ...(models ? { availableModelIds: models.available } : {}) },
    }
  },

  // A bearer token on every wire, Claude's included: Copilot reads no `x-api-key`.
  access: (credential) => ({
    apiKey: credential.accessToken,
    authToken: credential.accessToken,
    baseURL: apiBaseOf(credential.accessToken, enterpriseOf(credential)),
    headers: { ...COPILOT_HEADERS },
  }),
}
