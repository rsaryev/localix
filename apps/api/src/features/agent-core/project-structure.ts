import type { ExecutionEnvironment } from './tools/environment'
import { loadProjectFileIndex } from './project-file-index'

export const PROJECT_STRUCTURE_MAX_DEPTH = 2
export const PROJECT_STRUCTURE_MAX_LINES = 60
export const PROJECT_STRUCTURE_MAX_CHARS = 1_800

interface TreeNode {
  files: Set<string>
  dirs: Map<string, TreeNode>
}

function node(): TreeNode {
  return { files: new Set(), dirs: new Map() }
}

function safeParts(path: string): string[] | undefined {
  const safePath = Array.from(path)
    .map((character) => {
      const code = character.charCodeAt(0)
      if (code <= 31 || code === 127) return '�'
      return character === '`' ? 'ˋ' : character
    })
    .join('')
  const parts = safePath.split('/').filter((part) => part.length > 0 && part !== '.')
  if (!parts.length || parts.some((part) => part === '..')) return undefined
  return parts
}

function descendantFileCount(value: TreeNode): number {
  let count = value.files.size
  for (const child of value.dirs.values()) count += descendantFileCount(child)
  return count
}

/** Render a deterministic, names-only, shallow tree suitable for prompt context. */
export function renderProjectStructure(paths: readonly string[]): string | undefined {
  const root = node()
  for (const path of paths) {
    const parts = safeParts(path)
    if (!parts) continue
    let cursor = root
    for (const part of parts.slice(0, -1)) {
      let child = cursor.dirs.get(part)
      if (!child) {
        child = node()
        cursor.dirs.set(part, child)
      }
      cursor = child
    }
    cursor.files.add(parts.at(-1)!)
  }

  const lines: string[] = []
  let clipped = false
  const append = (line: string) => {
    if (lines.length >= PROJECT_STRUCTURE_MAX_LINES) {
      clipped = true
      return false
    }
    const projected = (lines.length ? lines.join('\n').length + 1 : 0) + line.length
    if (projected > PROJECT_STRUCTURE_MAX_CHARS) {
      clipped = true
      return false
    }
    lines.push(line)
    return true
  }
  const walk = (value: TreeNode, depth: number): void => {
    const indent = '  '.repeat(depth)
    for (const [name, child] of [...value.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      if (!append(`${indent}${name}/`)) return
      if (depth + 1 < PROJECT_STRUCTURE_MAX_DEPTH) walk(child, depth + 1)
      else {
        const count = descendantFileCount(child)
        if (count && !append(`${indent}  … ${count} ${count === 1 ? 'file' : 'files'}`)) return
      }
      if (clipped) return
    }
    for (const name of [...value.files].sort((a, b) => a.localeCompare(b))) {
      if (!append(`${indent}${name}`)) return
    }
  }
  walk(root, 0)
  if (!lines.length) return undefined
  if (clipped) {
    const marker = '… more entries omitted'
    while (lines.length >= PROJECT_STRUCTURE_MAX_LINES) lines.pop()
    while (lines.length && `${lines.join('\n')}\n${marker}`.length > PROJECT_STRUCTURE_MAX_CHARS) {
      lines.pop()
    }
    if (lines.length < PROJECT_STRUCTURE_MAX_LINES) lines.push(marker)
  }
  return lines.join('\n')
}

/** Best-effort by design: project discovery must never prevent a chat turn. */
export async function loadProjectStructureSnapshot(
  env: ExecutionEnvironment,
  root: string,
): Promise<string | undefined> {
  try {
    const indexed = await loadProjectFileIndex(env, root)
    return renderProjectStructure(indexed.paths)
  } catch {
    return undefined
  }
}
