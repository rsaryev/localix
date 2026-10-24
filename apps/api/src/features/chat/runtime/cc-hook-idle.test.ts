/**
 * hooks.md, Notification `idle_prompt`: "Claude finished responding about 60 seconds ago and you
 * haven't typed since", and no background agent is still running.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { buildCcHookRegistry } from '../../cc-hooks'
import { createCcHookSessions, IDLE_PROMPT_MS } from './cc-hook-sessions'

const dir = tempDirPerTest('cc-idle-')

async function sessionsWithIdleHook() {
  const timers: { fn: () => unknown; ms: number }[] = []
  const sessions = createCcHookSessions(undefined, {
    set: (fn, ms) => timers.push({ fn, ms }) - 1,
    clear: (handle) => {
      timers[handle as number] = { fn: () => undefined, ms: -1 }
    },
  })
  const out = join(dir(), 'idle.json')
  const { registry } = await buildCcHookRegistry({
    projectDir: dir(),
    pluginHooks: [],
    settingsHooks: [
      {
        source: 'user',
        raw: {
          hooks: {
            Notification: [
              { matcher: 'idle_prompt', hooks: [{ type: 'command', command: `cat > "${out}"` }] },
            ],
          },
        },
      },
    ],
  })
  sessions.remember('s1', { registry, projectDir: dir() })
  return { sessions, timers, out }
}

describe('idle_prompt', () => {
  test('fires 60 seconds after a reply when nothing happened since', async () => {
    const { sessions, timers, out } = await sessionsWithIdleHook()
    sessions.scheduleIdle('s1', () => false)
    expect(timers.at(-1)?.ms).toBe(IDLE_PROMPT_MS)
    await timers.at(-1)!.fn()
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    })
  })

  test('a new turn cancels it, and running background work holds it', async () => {
    const { sessions, timers, out } = await sessionsWithIdleHook()
    sessions.scheduleIdle('s1', () => false)
    sessions.cancelIdle('s1')
    expect(timers.at(-1)?.ms).toBe(-1)
    sessions.scheduleIdle('s1', () => true)
    await timers.at(-1)!.fn()
    expect(existsSync(out)).toBe(false)
  })
})
