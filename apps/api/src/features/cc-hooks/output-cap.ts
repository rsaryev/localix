/**
 * hooks.md, JSON output: "A hook's `additionalContext`, `systemMessage`, and `initialUserMessage`
 * strings, and its plain stdout, are capped at 10,000 characters". Each is measured on its own;
 * one over the limit is saved to a file in the session directory and replaced with the file's path
 * and a preview of up to its first 2,000 characters.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CcHookOutcome } from './contracts'

export const CC_HOOK_TEXT_CAP = 10_000
const PREVIEW_CHARS = 2_000

/** One string within the cap: as it was, or the saved file's path and a preview. */
function capped(text: string, dir: string): string {
  if (text.length <= CC_HOOK_TEXT_CAP) return text
  let path: string
  try {
    mkdirSync(dir, { recursive: true })
    path = join(dir, `hook-output-${randomUUID()}.txt`)
    writeFileSync(path, text)
  } catch {
    return text.slice(0, CC_HOOK_TEXT_CAP)
  }
  return `Hook output was ${text.length} characters and was saved to ${path}. Preview:\n${text.slice(0, PREVIEW_CHARS)}`
}

/** The outcome with its model- and person-facing strings within the cap. */
export function capHookOutput(
  outcome: CcHookOutcome,
  dir = join(tmpdir(), 'localix-hooks'),
): CcHookOutcome {
  const { additionalContext, systemMessage, initialUserMessage } = outcome
  if (
    (additionalContext?.length ?? 0) <= CC_HOOK_TEXT_CAP &&
    (systemMessage?.length ?? 0) <= CC_HOOK_TEXT_CAP &&
    (initialUserMessage?.length ?? 0) <= CC_HOOK_TEXT_CAP
  )
    return outcome
  return {
    ...outcome,
    ...(additionalContext !== undefined
      ? { additionalContext: capped(additionalContext, dir) }
      : {}),
    ...(systemMessage !== undefined ? { systemMessage: capped(systemMessage, dir) } : {}),
    ...(initialUserMessage !== undefined
      ? { initialUserMessage: capped(initialUserMessage, dir) }
      : {}),
  }
}
