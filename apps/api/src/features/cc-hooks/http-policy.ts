import type { CcHookRegistry } from './contracts'

/**
 * Claude Code's limits on http hooks (settings-reference.md, `allowedHttpHookUrls`,
 * `httpHookAllowedEnvVars`), for hooks from every source, as the settings policy answers them
 * (`SettingsHooks.httpHook` of `plugins/kit`): a hook whose URL the allowlist does not name is
 * dropped, and a hook's headers read only the variables the answer lists.
 */
export type HttpHookCheck = (
  url: string,
  hookAllowedEnvVars: readonly string[],
) => { run: true; interpolate: readonly string[] } | { run: false; message: string }

/** Hold the registry's http hooks to the policy, in place. */
export function applyHttpHookPolicy(registry: CcHookRegistry, check: HttpHookCheck): void {
  for (const groups of Object.values(registry))
    for (const group of groups ?? []) {
      group.handlers = group.handlers.flatMap((handler) => {
        if (handler.kind !== 'http') return [handler]
        const verdict = check(handler.httpUrl ?? '', handler.httpAllowedEnvVars ?? [])
        if (!verdict.run) return []
        return [{ ...handler, httpAllowedEnvVars: [...verdict.interpolate] }]
      })
    }
}
