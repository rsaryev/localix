import { isAbsolute, resolve } from 'node:path'

/**
 * Resolve a tool target path against its requested or session-default cwd.
 * Kept in the SDK so plugin tools and host tools agree on relative-path semantics.
 */
export function resolveTargetPath(filePath: string, cwd?: string, defaultCwd?: string): string {
  const base = cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(defaultCwd ?? process.cwd(), cwd)
    : (defaultCwd ?? process.cwd())
  return resolve(base, filePath)
}
