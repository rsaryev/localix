import { describe, expect, test } from 'bun:test'

import { createBashTool } from './bash'
import { isAlive, killProcessTree } from '../../../../lib/process-tree'

/**
 * A foreground command that outruns its timeout is PROMOTED to a background job,
 * not killed. The work the model asked for keeps running, its output so far comes
 * back in the same result, and the reason is explicit so the model can tell this
 * from a job it chose to start.
 */
describe('foreground timeout promotes to a background job', () => {
  test.skipIf(process.platform === 'win32')(
    'returns the background shape with the reason, and the command keeps running',
    async () => {
      const tool = createBashTool()
      const result = await tool.execute(
        'promote-1',
        { command: 'echo working; sleep 30', timeout: 1 },
        undefined,
      )

      // Not an error: nothing failed, it is just not done.
      expect(result.isError).toBeUndefined()
      expect(result.content).toContain('No result after 1s')
      expect(result.content).toContain('working')
      expect(result.content).toContain('job_id')

      const details = result.details as { background?: string; isBackground?: boolean }
      expect(details.background).toBe('promoted')
      expect(details.isBackground).toBe(true)
    },
    20_000,
  )

  test.skipIf(process.platform === 'win32')(
    'a command that finishes inside its budget is untouched',
    async () => {
      const tool = createBashTool()
      const result = await tool.execute(
        'promote-2',
        { command: 'echo quick', timeout: 5 },
        undefined,
      )

      const details = result.details as { background?: string; exitCode?: number }
      expect(details.background).toBeUndefined()
      expect(details.exitCode).toBe(0)
      expect(result.content).toContain('quick')
    },
    20_000,
  )

  test.skipIf(process.platform === 'win32')(
    'promotion is off where a job could not have been requested, and still kills',
    async () => {
      // allowBackground:false means the model has no `background` parameter at all —
      // handing it a job it cannot poll would be worse than the honest timeout.
      const tool = createBashTool(undefined, undefined, { allowBackground: false })
      const result = await tool.execute(
        'promote-3',
        { command: 'echo working; sleep 30', timeout: 1 },
        undefined,
      )

      expect(result.isError).toBe(true)
      expect(result.content).toContain('Timed out after 1s')
      const details = result.details as { background?: string; jobStatus?: string }
      expect(details.background).toBeUndefined()
      expect(details.jobStatus).toBe('timeout')
    },
    20_000,
  )

  test.skipIf(process.platform === 'win32')(
    'a user abort during the foreground wait still kills, never promotes',
    async () => {
      const tool = createBashTool()
      const abort = new AbortController()
      const run = tool.execute(
        'promote-4',
        { command: 'echo working; sleep 30', timeout: 30 },
        abort.signal,
      )
      await Bun.sleep(300)
      abort.abort()
      const result = await run

      const details = result.details as { background?: string }
      expect(details.background).toBeUndefined()
      expect(result.content).not.toContain('job_id')
    },
    20_000,
  )
})

/** The promoted job is a REAL job: pollable, killable, and it reaps cleanly. */
describe('a promoted job behaves like any other', () => {
  test.skipIf(process.platform === 'win32')(
    'keeps producing output after promotion and dies on kill',
    async () => {
      const tool = createBashTool()
      const pidFile = `/tmp/localix-promote-${Date.now()}.pid`
      const result = await tool.execute(
        'promote-5',
        { command: `echo $$ > ${pidFile}; echo early; sleep 30`, timeout: 1 },
        undefined,
      )
      expect(result.content).toContain('early')

      const pid = Number((await Bun.file(pidFile).text()).trim())
      expect(isAlive(pid)).toBe(true)

      killProcessTree(pid, 0)
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline && isAlive(pid)) await Bun.sleep(20)
      expect(isAlive(pid)).toBe(false)
    },
    20_000,
  )
})

describe('promotion respects the session job budget', () => {
  test.skipIf(process.platform === 'win32')(
    'at capacity it times out honestly instead of pinning one more process',
    async () => {
      const tool = createBashTool()
      // The gate reads the host's live job records; at the cap, an honest timeout
      // beats a job id competing with ten the model has not reaped yet.
      const registry = {
        registerActions: () => () => {},
        countBackgroundJobs: () => 10,
        emitBackground: () => {},
      }
      const result = await tool.execute(
        'promote-capped',
        { command: 'echo working; sleep 30', timeout: 1 },
        undefined,
        undefined,
        { asyncRegistry: registry } as never,
      )

      expect(result.isError).toBe(true)
      expect(result.content).toContain('not promoted')
      expect(result.content).toContain('limit 10')
      const details = result.details as { background?: string; jobStatus?: string }
      expect(details.background).toBeUndefined()
      expect(details.jobStatus).toBe('timeout')
    },
    20_000,
  )

  test.skipIf(process.platform === 'win32')(
    'below capacity it still promotes',
    async () => {
      const tool = createBashTool()
      // A promoted job outlives the call, so its throttled stream flush lands AFTER
      // this test returns: a fake registry missing `emitBackground` would surface as
      // an error inside whichever test happened to be running then.
      let killJob = () => {}
      const registry = {
        registerActions: (_id: string, actions: Record<string, { execute: () => void }>) => {
          killJob = () => actions.kill?.execute()
          return () => {}
        },
        countBackgroundJobs: () => 3,
        emitBackground: () => {},
      }
      const result = await tool.execute(
        'promote-under-cap',
        { command: 'echo working; sleep 30', timeout: 1 },
        undefined,
        undefined,
        { asyncRegistry: registry } as never,
      )

      expect(result.isError).toBeUndefined()
      expect((result.details as { background?: string }).background).toBe('promoted')
      killJob()
    },
    20_000,
  )
})

describe('work the model asks for respects the same budget', () => {
  // A full set the model has not reaped. Any spawn would register an action; none may.
  const atCap = () => {
    let registered = 0
    const registry = {
      registerActions: () => {
        registered += 1
        return () => {}
      },
      countBackgroundJobs: () => 10,
      emitBackground: () => {},
    }
    return { registry, registered: () => registered }
  }

  test('background:true at capacity is refused before anything spawns', async () => {
    const cap = atCap()
    const result = await createBashTool().execute(
      'background-capped',
      { command: 'sleep 30', background: true },
      undefined,
      undefined,
      { asyncRegistry: cap.registry } as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('limit 10')
    expect(cap.registered()).toBe(0)
  })

  test('an interactive pane at capacity is refused before it opens', async () => {
    const cap = atCap()
    let opened = 0
    const terminalControl = {
      open: async () => {
        opened += 1
        return { terminalId: 'pty-1', screen: null }
      },
    }
    const result = await createBashTool(undefined, undefined, {
      terminalControl: terminalControl as never,
    }).execute('open-capped', { action: 'open', command: 'python3' }, undefined, undefined, {
      asyncRegistry: cap.registry,
    } as never)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('limit 10')
    expect(opened).toBe(0)
  })
})
