import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { checkMiniAppBindings } from '../check/bindings'
import { MANIFEST_FILE } from '../check/check'
import { checkMiniAppRoutes } from '../check/routes'
import { checkMiniAppStyle } from '../check/style'
import type { Kit } from '../kit/kit'

/**
 * The PostToolUse hook on Edit and Write: the quick static gates (house style, route bodies,
 * message bindings) on the file just written, when it belongs to a mini app. A problem goes back to
 * the agent as context next to the edit, so it is fixed while the file is open rather than found by
 * `mini-app check` a dozen edits later. It never blocks, never builds and never downloads; anything
 * it cannot judge quickly it leaves to `mini-app check`.
 */

interface HookInput {
  tool_input?: { file_path?: unknown }
}

const SKIPPED = new Set(['node_modules', 'dist', '.git'])
const SOURCE = /\.(?:tsx?|css)$/u

/** The mini app folder holding `file`, or null; built output and dependencies are not sources. */
export function miniAppRootOf(file: string): string | null {
  let dir = dirname(file)
  while (true) {
    if (existsSync(join(dir, MANIFEST_FILE))) {
      const parts = relative(dir, file).split(sep)
      return parts.some((part) => SKIPPED.has(part)) ? null : dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The hook's stdout for one tool call, or null when there is nothing to say. */
export async function postEdit(raw: string, loadKit: () => Promise<Kit>): Promise<string | null> {
  let input: HookInput
  try {
    input = JSON.parse(raw) as HookInput
  } catch {
    return null
  }
  const file = input.tool_input?.file_path
  if (typeof file !== 'string' || !SOURCE.test(file)) return null
  const root = miniAppRootOf(file)
  if (!root) return null
  const kit = await loadKit().catch(() => null)
  if (!kit) return null
  const own = relative(root, file).split(sep).join('/')
  // One gate that cannot run (a kit without its stylesheets) leaves the others to speak.
  const found = (
    await Promise.allSettled([
      checkMiniAppStyle(root, kit),
      checkMiniAppRoutes(root, kit),
      checkMiniAppBindings(root),
    ])
  )
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((line) => line.startsWith(`${own}:`))
  if (!found.length) return null
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [
        `mini-app: ${own} breaks Localix's rules for mini apps — fix it now:`,
        ...found.map((line) => `- ${line}`),
      ].join('\n'),
    },
  })
}
