import { issue, type PluginIssue } from './issues'

/**
 * `hooks/hooks.json`: `{ description?, hooks: { <Event>: [...] }, modules?: ["./register.js"] }`.
 * A hooks file needs the `hooks` wrapper (an inline manifest `hooks` value is the bare event map).
 * A file with `modules` makes the plugin a mod: its hooks module exports `register(on, options)`.
 */
export interface HooksFile {
  description?: string
  /** Event name → matcher groups, as written. */
  hooks: Record<string, unknown>
  /** Hooks-module paths, relative to the hooks file. At most one. */
  modules: string[]
}

/** File extensions a hooks module may have; every one loads as an ES module. */
export const HOOKS_MODULE_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
]

export function parseHooksFile(
  raw: unknown,
  path: string,
): { file: HooksFile | null; issues: PluginIssue[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { file: null, issues: [issue('error', path, 'The hooks file is not a JSON object')] }
  const record = raw as Record<string, unknown>
  const hooks = record.hooks
  if (hooks !== undefined && (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)))
    return { file: null, issues: [issue('error', path, '"hooks" must be an object of events')] }
  if (hooks === undefined && record.modules === undefined)
    return {
      file: null,
      issues: [issue('error', path, 'A hooks file wraps its events in "hooks": { … }')],
    }
  const issues: PluginIssue[] = []
  const modules = Array.isArray(record.modules)
    ? record.modules.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (
    record.modules !== undefined &&
    (!Array.isArray(record.modules) || modules.length !== record.modules.length)
  )
    issues.push(issue('error', `${path}#modules`, '"modules" is a list of module paths'))
  if (modules.length > 1)
    issues.push(issue('error', `${path}#modules`, 'A plugin has at most one hooks module'))
  for (const module of modules) {
    if (!HOOKS_MODULE_EXTENSIONS.some((ext) => module.endsWith(ext)))
      issues.push(
        issue('error', `${path}#modules`, `Not a JavaScript or TypeScript module: ${module}`),
      )
  }
  return {
    file: {
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      hooks: (hooks as Record<string, unknown> | undefined) ?? {},
      modules: modules.slice(0, 1),
    },
    issues,
  }
}
