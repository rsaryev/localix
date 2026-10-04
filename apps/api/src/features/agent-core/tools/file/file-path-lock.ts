import { dirname, resolve } from 'node:path'

import { createKeyedSerializer } from '../../../../lib/keyed-serializer'
import { isPathWithin } from '../../../../lib/path-containment'

// ── Per-path mutation queue ─────────────────────────────────────────────────────
//
// Serializes read-modify-write cycles targeting the same absolute path so
// concurrent runs/jobs can't interleave. Different paths still run in parallel.
//
// "FIFO-serialize async work per key" is `lib/keyed-serializer.ts`'s algorithm — it
// says so in its own header, having been written as a mirror of the hand-rolled
// queue that used to live here. Two owners of one idea is one too many: a path lock
// IS a keyed serializer whose key is the resolved path.

const serializeByPath = createKeyedSerializer()

export function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return serializeByPath(resolve(path), fn)
}

/**
 * Acquire locks for several paths (deduped, sorted — the consistent global order
 * makes nested acquisition deadlock-free) and run `fn` while holding all of them.
 */
export async function withPathLocks<T>(paths: readonly string[], fn: () => Promise<T>): Promise<T> {
  const unique = [...new Set(paths.map((p) => resolve(p)))].sort()
  const run = (i: number): Promise<T> =>
    i >= unique.length ? fn() : withPathLock(unique[i], () => run(i + 1))
  return run(0)
}

/**
 * Exact targets plus the directory namespaces below `workspaceRoot` that own them.
 *
 * Exact-only locks let a subtree mutation (`rm -r src`) race a file writer
 * (`src/deep/a.ts`) because their keys differ. Locking every ancestor INCLUDING the
 * workspace root would fix safety by serializing the entire project. Excluding that
 * root preserves parallelism between top-level siblings while still making a
 * directory entry conflict with every descendant operation. An explicitly allowed
 * target outside the workspace (desktop-dropped file / permission-approved tool)
 * gets its immediate parent as the narrowest useful namespace boundary.
 */
export function workspaceLockPaths(
  workspaceRoot: string,
  targetPaths: readonly string[],
): string[] {
  const root = resolve(workspaceRoot)
  const locks = new Set<string>()
  for (const raw of targetPaths) {
    const target = resolve(raw)
    locks.add(target)
    if (target === root) continue

    if (!isPathWithin(root, target)) {
      locks.add(dirname(target))
      continue
    }

    let parent = dirname(target)
    while (parent !== root) {
      locks.add(parent)
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
  }
  return [...locks]
}

export interface FileToolConcurrencyOptions {
  /**
   * Allow a mutating file tool (write/apply_patch) to run concurrently with
   * other parallel-eligible calls in the same batch. Safe because (a) the loop's
   * scope-path waves serialize same-path calls in batch order, and (b) the
   * per-path mutation lock serializes the read-modify-write cycle. Enable only in
   * modes without per-tool approval prompts (auto/yolo) — concurrent HITL
   * confirms would stack overlays.
   */
  parallel?: boolean
}
