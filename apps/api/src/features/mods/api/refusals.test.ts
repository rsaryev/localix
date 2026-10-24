import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModsApi } from '@localixai/claude-plugin/mods'
import { hostWithMod } from '../testing/testing-host'

/** `$` calls Localix answers in Claude Code's shapes, or refuses as Claude Code documents. */

const call = ($: ModsApi, path: string, ...args: unknown[]) => {
  const [namespace, name] = path.split('.') as [string, string]
  const method = $[namespace]?.[name] as ((...rest: unknown[]) => unknown) | undefined
  if (!method) return Promise.resolve(`no $.${path}`)
  return Promise.resolve(method(...args)).catch((error: Error) => `threw: ${error.message}`)
}

async function answers(calls: (($: ModsApi, dir: string) => unknown)[]) {
  const got: unknown[] = []
  let cwd = ''
  const { scope, dir } = await hostWithMod((on) => {
    on('turn.start', async ($, e, next) => {
      for (const one of calls) got.push(await one($, cwd))
      return next(e)
    })
  })
  cwd = dir
  writeFileSync(join(dir, 'note.md'), 'hi')
  await scope.turnStart('go', 't1')
  return got
}

describe('$ calls in Claude Code’s shapes', () => {
  test('process.run says whether it cut the output; fs.list gives mtimeMs; env.set answers', async () => {
    const [run, listed, set] = await answers([
      ($) => call($, 'process.run', ['echo', 'hi']),
      ($) => call($, 'fs.list', '.'),
      ($) => call($, 'env.set', 'MOD_FLAG', '1'),
    ])
    expect(run).toEqual({
      exitCode: 0,
      stdout: 'hi\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    })
    expect(listed).toContainEqual(
      expect.objectContaining({ name: 'note.md', kind: 'file', mtimeMs: expect.any(Number) }),
    )
    expect(set).toEqual({})
  })

  test('what the desktop cannot do is refused as Claude Code refuses it, never a TypeError', async () => {
    const got = await answers([
      ($) => call($, 'ui.selection'),
      ($) => call($, 'ui.view', { agentId: 'a1' }),
      ($) => call($, 'session.identity'),
      ($) => call($, 'session.send', { to: 'other', text: 'hi' }),
      ($) => call($, 'mcp.connect', 'docs'),
      ($) => call($, 'process.spawn', { argv: ['ls'] }),
    ])
    expect(got[0]).toBeUndefined()
    expect(got[1]).toEqual({ deny: expect.any(String) })
    expect(got[2]).toEqual({ deny: expect.any(String) })
    expect(got[3]).toEqual({ isDelivered: false, reason: expect.any(String) })
    expect(got[4]).toEqual({ isConnected: false, reason: 'unlisted', message: expect.any(String) })
    expect(got[5]).toEqual(expect.stringContaining('threw: process.spawn'))
  })
})
