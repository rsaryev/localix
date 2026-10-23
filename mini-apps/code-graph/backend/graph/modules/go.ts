import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import type { GoModule } from './config'
import type { ModuleTarget, ProjectFiles } from './target'

/**
 * Go import paths. A path under one of the project's modules (`go.mod`) is a directory of the
 * project — the package — when that directory holds Go files; anything else is an external
 * package named by its full import path (`fmt`, `github.com/x/y`).
 */
export function createGoResolver(project: ProjectFiles, modules: GoModule[]) {
  const byLength = [...modules].sort((a, b) => b.module.length - a.module.length)
  const goDirs = new Set<string>()
  for (const path of project.files) {
    if (!path.endsWith('.go')) continue
    const slash = path.lastIndexOf('/')
    goDirs.add(slash < 0 ? '' : path.slice(0, slash))
  }

  return function resolve(_from: string, specifier: string): ModuleTarget | null {
    // An import path under a module: ancestry over `/`-separated import paths.
    const owner = byLength.find((mod) => isAtOrUnder(mod.module, specifier))
    if (!owner) return { kind: 'package', name: specifier }
    const rest = specifier.slice(owner.module.length + 1)
    const dir = [owner.dir, rest].filter(Boolean).join('/')
    return goDirs.has(dir) ? { kind: 'directory', path: dir } : null
  }
}
