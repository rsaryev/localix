import { posix } from 'node:path'
import { isStrictlyUnder } from '@localixai/path-containment/ancestry'
import type { ModuleTarget, ProjectFiles } from './target'

/**
 * Python module resolution without an interpreter.
 *
 * An absolute import resolves against the project's import ROOTS, inferred the way tools do when
 * no configuration says otherwise: the project root, and the parent of every top-level package (a
 * directory with `__init__.py` whose parent has none). A module is registered only through a chain
 * of packages from a root — registering every path suffix made `import json` resolve to some
 * `utils/json.py`, an edge that looks right and is wrong. A name two roots both provide stays
 * unresolved for the same reason.
 */
export function createPythonResolver(project: ProjectFiles) {
  const isPackage = (dir: string) => project.files.has(dir ? `${dir}/__init__.py` : '__init__.py')
  const modules = new Map<string, string[]>()
  const register = (name: string, path: string) => {
    if (!name) return
    const known = modules.get(name)
    if (!known) modules.set(name, [path])
    else if (!known.includes(path)) known.push(path)
  }

  const roots = new Set<string>([''])
  for (const dir of project.dirs) {
    if (dir && isPackage(dir) && !isPackage(posix.dirname(dir) === '.' ? '' : posix.dirname(dir))) {
      roots.add(posix.dirname(dir) === '.' ? '' : posix.dirname(dir))
    }
  }
  for (const path of project.files) {
    if (!path.endsWith('.py')) continue
    for (const root of roots) {
      if (root && !isStrictlyUnder(root, path)) continue
      const relative = root ? path.slice(root.length + 1) : path
      const segments = relative.slice(0, -'.py'.length).split('/')
      const packages = segments.slice(0, -1)
      // Every directory between the root and the file must be a package.
      let through = root
      const chained = packages.every((segment) => {
        through = through ? `${through}/${segment}` : segment
        return isPackage(through)
      })
      if (!chained) continue
      if (segments.at(-1) === '__init__') register(packages.join('.'), path)
      else register(segments.join('.'), path)
    }
  }

  function relative(from: string, specifier: string): ModuleTarget | null {
    const dots = /^\.+/.exec(specifier)?.[0].length ?? 0
    let dir = posix.dirname(from) === '.' ? '' : posix.dirname(from)
    for (let up = 1; up < dots; up += 1) {
      if (!dir) return null
      dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir)
    }
    const rest = specifier.slice(dots).split('.').filter(Boolean).join('/')
    const base = rest ? (dir ? `${dir}/${rest}` : rest) : dir
    if (rest && project.files.has(`${base}.py`)) return { kind: 'file', path: `${base}.py` }
    const init = base ? `${base}/__init__.py` : '__init__.py'
    if (project.files.has(init)) return { kind: 'file', path: init }
    return project.dirs.has(base) ? { kind: 'directory', path: base } : null
  }

  return function resolve(from: string, specifier: string): ModuleTarget | null {
    if (specifier.startsWith('.')) return relative(from, specifier)
    const candidates = modules.get(specifier)
    if (candidates?.length === 1 && candidates[0]) return { kind: 'file', path: candidates[0] }
    if (candidates && candidates.length > 1) return null
    return { kind: 'package', name: specifier.split('.')[0] ?? specifier }
  }
}
