import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import type { CcHookHandler, CcHookInput } from './contracts'
import { executeHook } from './executor'

/** A hook process receives the `env` of Claude Code's settings, under Claude Code's own variables. */
const dir = tempDirPerTest('cc-hook-settings-env-')
const silent = { warn: () => {}, info: () => {} }
const input = { hook_event_name: 'PostToolUse', session_id: 's1' } as unknown as CcHookInput

test("a hook sees the settings' env; CLAUDE_PROJECT_DIR stays the project's", async () => {
  const out = join(dir(), 'env.txt')
  const handler = {
    type: 'command',
    command: `printf '%s|%s' "$API_BASE" "$CLAUDE_PROJECT_DIR" > '${out}'`,
    timeoutMs: 10_000,
    source: 'settings',
  } as unknown as CcHookHandler
  await executeHook(handler, input, dir(), silent, false, undefined, {
    settings: { API_BASE: 'https://team.example', CLAUDE_PROJECT_DIR: '/elsewhere' },
  })
  expect(readFileSync(out, 'utf8')).toBe(`https://team.example|${dir()}`)
})
