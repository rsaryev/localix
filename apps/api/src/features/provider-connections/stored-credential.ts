import { isSecretSettingName } from '@localixai/agent/catalog'
import type { RuntimeCredential } from '@localixai/agent/runtime'

/** A credential as the vault stores it (JSON); undefined when it is not one this service wrote. */
export function decodeCredential(encoded: string): RuntimeCredential | undefined {
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!parsed || typeof parsed !== 'object') return undefined
    const credential = parsed as Partial<RuntimeCredential>
    if (credential.type === 'api-key') {
      if (typeof credential.key !== 'string') return undefined
      return { type: 'api-key', key: credential.key, env: credential.env }
    }
    if (
      credential.type === 'oauth' &&
      typeof credential.accessToken === 'string' &&
      typeof credential.refreshToken === 'string' &&
      typeof credential.expiresAt === 'number'
    ) {
      return {
        type: 'oauth',
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        expiresAt: credential.expiresAt,
        extra: credential.extra,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Every secret a stored credential carries, for the exposure shield: the API key and any setting
 * whose name reads like a secret (one an older build stored before such names were refused), or
 * both halves of an OAuth credential — an echoed refresh token is worse than an echoed access
 * token, since it does not expire on its own.
 */
export function credentialSecrets(credential: RuntimeCredential): string[] {
  const values =
    credential.type === 'api-key'
      ? [
          credential.key,
          ...Object.entries(credential.env ?? {})
            .filter(([name]) => isSecretSettingName(name))
            .map(([, value]) => value),
        ]
      : [credential.accessToken, credential.refreshToken]
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
}
