import type { CcHookRegistry } from './contracts'

/**
 * Claude Code's limits on http hooks (settings-reference.md, `allowedHttpHookUrls`,
 * `httpHookAllowedEnvVars`), for hooks from every source: with an allowlist, an http hook runs
 * only when its URL matches one of the patterns (`*` a wildcard, the host compared without case
 * and without a trailing dot), and an empty list blocks them all; a hook's headers read a variable
 * only when both its own `allowedEnvVars` and the settings list name it.
 */
export interface HttpHookPolicy {
  allowedUrls?: readonly string[]
  allowedEnvVars?: readonly string[]
}

/** The URL with its host lowercased and a trailing dot dropped, as DNS reads it. */
function normalized(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
    return parsed.toString()
  } catch {
    return url
  }
}

const patternOf = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  )

export function httpUrlAllowed(url: string, allowed: readonly string[]): boolean {
  const target = normalized(url)
  return allowed.some((pattern) => patternOf(pattern).test(target) || patternOf(pattern).test(url))
}

/** Hold the registry's http hooks to the policy, in place. */
export function applyHttpHookPolicy(registry: CcHookRegistry, policy: HttpHookPolicy): void {
  if (!policy.allowedUrls && !policy.allowedEnvVars) return
  for (const groups of Object.values(registry))
    for (const group of groups ?? []) {
      group.handlers = group.handlers.flatMap((handler) => {
        if (handler.kind !== 'http') return [handler]
        if (policy.allowedUrls && !httpUrlAllowed(handler.httpUrl ?? '', policy.allowedUrls))
          return []
        if (!policy.allowedEnvVars) return [handler]
        const outer = new Set(policy.allowedEnvVars)
        return [
          {
            ...handler,
            httpAllowedEnvVars: (handler.httpAllowedEnvVars ?? []).filter((name) =>
              outer.has(name),
            ),
          },
        ]
      })
    }
}
