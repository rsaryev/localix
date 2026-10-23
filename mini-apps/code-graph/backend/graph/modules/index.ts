import type { LanguageId } from '../../../shared/model'
import type { ProjectConfig } from './config'
import { createGoResolver } from './go'
import { createPythonResolver } from './python'
import type { ModuleTarget, ProjectFiles } from './target'
import { createTypeScriptResolver } from './typescript'

export type { ModuleTarget, ProjectFiles } from './target'
export { projectFiles } from './target'

export type ModuleResolver = (
  from: string,
  language: LanguageId,
  specifier: string,
) => ModuleTarget | null

/** One resolver per language family, built once per graph from the same file set and config. */
export function createModuleResolver(project: ProjectFiles, config: ProjectConfig): ModuleResolver {
  const typescript = createTypeScriptResolver(project, config)
  const python = createPythonResolver(project)
  const go = createGoResolver(project, config.goModules)
  const memo = new Map<string, ModuleTarget | null>()
  return (from, language, specifier) => {
    // Keyed by the importing DIRECTORY: a relative specifier depends on it, and so does an alias —
    // `@/x` means a different file under each package's own tsconfig in a monorepo. Only Go's
    // module paths are global.
    const scope = language === 'go' ? '' : from.slice(0, from.lastIndexOf('/') + 1)
    const key = `${language}\u0000${scope}\u0000${specifier}`
    if (memo.has(key)) return memo.get(key) ?? null
    const target =
      language === 'python'
        ? python(from, specifier)
        : language === 'go'
          ? go(from, specifier)
          : typescript(from, specifier)
    memo.set(key, target)
    return target
  }
}
