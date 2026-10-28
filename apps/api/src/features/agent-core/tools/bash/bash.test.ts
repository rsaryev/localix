import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import {
  bashToolInputSchema,
  classifyBgExit,
  createBashTool,
  isDangerous,
  withCommandShims,
  withPythonShim,
  withTimeoutShim,
} from './bash'
import { bashInputSchemaFor, type BashToolDetails } from './bash-types'
import { BATCH_OUTPUT_BUDGET_BYTES } from './bash-output'
import type { TerminalDetails } from '../terminal/terminal'
import { outsideHomePathsInCommand } from '../workspace'

describe('bash tool guidance', () => {
  test('does not promise a confirmation gate the run may not have', () => {
    const description = createBashTool().description
    expect(description).not.toContain('require explicit user confirmation')
    expect(description).not.toMatch(/confirm/i)
  })

  test('states the wait rule once, on `until`, not in the description', () => {
    // The anti-poll rule used to ride here, on `until`, in `jobs` and in the prompt: four
    // copies on every request. The field is where the model is looking when it needs it.
    const tool = createBashTool(undefined, undefined, { waitHost: {} as never })
    expect(tool.description).not.toMatch(/sleep|until/)
    expect(JSON.stringify(tool.inputSchema.toJSONSchema?.())).toMatch(/sleep\/retry/)
  })

  test('offers `until` only when a wait host can serve it', () => {
    // Without a host the call answers "not available in this session"; advertising the field
    // anyway is the capability overclaim that costs a model a turn to discover.
    const schemaOf = (tool: ReturnType<typeof createBashTool>) =>
      JSON.stringify(tool.inputSchema.toJSONSchema?.())
    expect(schemaOf(createBashTool())).not.toContain('"until"')
    expect(schemaOf(createBashTool(undefined, undefined, { waitHost: {} as never }))).toContain(
      '"until"',
    )
  })

  test('commands and PTY actions need no description label on the wire', () => {
    expect(bashToolInputSchema.safeParse({ command: 'ls' }).success).toBe(true)
    expect(bashToolInputSchema.safeParse({ action: 'screen', terminal_id: 't1' }).success).toBe(
      true,
    )
    expect(bashToolInputSchema.toJSONSchema().properties).not.toHaveProperty('description')
    const legacy = bashToolInputSchema.parse({ command: 'ls', description: 'List' })
    expect(legacy).toEqual({ command: 'ls' })
  })
})

describe('withTimeoutShim', () => {
  const GUARD = 'command -v timeout >/dev/null 2>&1 ||'

  test('prepends the guarded shim only when timeout is a command word', () => {
    expect(withTimeoutShim('timeout 3 npm run dev')).toContain(GUARD)
    expect(withTimeoutShim('cd x && timeout 5 node server.js')).toContain(GUARD)
    expect(withTimeoutShim('timeout 8 npm run dev 2>&1 | grep Local:')).toContain(GUARD)
    expect(withTimeoutShim('a | timeout 2 b')).toContain(GUARD)
    // The original command is preserved verbatim after the prelude.
    expect(withTimeoutShim('timeout 3 ls').endsWith('timeout 3 ls')).toBe(true)
  })

  test('leaves commands without a timeout invocation untouched', () => {
    for (const cmd of [
      'npm run dev',
      'rg --timeout 3 foo',
      'mytimeout 3 x',
      'echo timeout',
      'gtimeout 3 ls',
    ]) {
      expect(withTimeoutShim(cmd)).toBe(cmd)
    }
  })
})

describe('withPythonShim', () => {
  const GUARD = 'command -v python >/dev/null 2>&1 ||'

  test('prepends the guarded shim only when python is a command word', () => {
    expect(withPythonShim('python -m pytest tests/')).toContain(GUARD)
    expect(withPythonShim('cd app && python script.py')).toContain(GUARD)
    expect(withPythonShim('python manage.py migrate | tee log')).toContain(GUARD)
    // Original command preserved verbatim after the prelude.
    expect(withPythonShim('python -V').endsWith('python -V')).toBe(true)
  })

  test('leaves non-bare-python commands untouched', () => {
    for (const cmd of [
      'python3 -m pytest',
      'python2 x.py',
      'ipython',
      'cd mypython && ls',
      'pip install python-dateutil',
      'echo python.py',
    ]) {
      expect(withPythonShim(cmd)).toBe(cmd)
    }
  })

  test('withCommandShims applies both timeout and python shims', () => {
    const both = withCommandShims('timeout 5 python -m pytest')
    expect(both).toContain('command -v timeout')
    expect(both).toContain('command -v python')
    expect(both.endsWith('timeout 5 python -m pytest')).toBe(true)
  })
})

describe('classifyBgExit', () => {
  const c = (exitCode: number | null, byUser = false, byTimeout = false) =>
    classifyBgExit({ byUser, byTimeout, exitCode })

  test('our own kill/timeout paths win regardless of exit code', () => {
    expect(c(0, true)).toBe('killed')
    expect(c(143, false, true)).toBe('timeout')
  })

  test('clean exit is completed; a real non-signal error is failed', () => {
    expect(c(0)).toBe('completed')
    expect(c(1)).toBe('failed')
    expect(c(2)).toBe('failed')
  })

  test('graceful STOP signals read as killed, not failed (hot-reload / ^C)', () => {
    expect(c(130)).toBe('killed') // SIGINT (^C)
    expect(c(143)).toBe('killed') // SIGTERM (dev-server reload kills the group)
    expect(c(137)).toBe('killed') // SIGKILL
    expect(c(129)).toBe('killed') // SIGHUP
  })

  test('CRASH signals stay failed — they are genuine failures', () => {
    expect(c(134)).toBe('failed') // SIGABRT
    expect(c(139)).toBe('failed') // SIGSEGV
  })

  test('unknown/null exit is failed (no signal evidence)', () => {
    expect(c(null)).toBe('failed')
    expect(c(-1)).toBe('failed')
  })
})

describe('bashToolInputSchema', () => {
  test('accepts a minimal command with every other field optional', () => {
    const r = bashToolInputSchema.safeParse({ command: 'ls -la' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.command).toBe('ls -la')
      expect(r.data.timeout).toBeUndefined()
      expect(r.data.background).toBeUndefined()
    }
  })

  test('rejects an empty command string', () => {
    expect(bashToolInputSchema.safeParse({ command: '' }).success).toBe(false)
  })

  test('accepts an empty object at the schema level (command xor commands enforced in execute)', () => {
    // command is optional so a `commands`-only call validates; execute rejects it.
    expect(bashToolInputSchema.safeParse({}).success).toBe(true)
  })

  test('accepts a non-empty commands batch with keep_going', () => {
    const batch = (extra: object) => bashToolInputSchema.safeParse(extra).success
    expect(batch({ commands: ['echo a', 'echo b'] })).toBe(true)
    expect(batch({ commands: ['x'], keep_going: true })).toBe(true)
    // empty array and empty entries are rejected
    expect(batch({ commands: [] })).toBe(false)
    expect(batch({ commands: [''] })).toBe(false)
  })

  test('enforces the timeout bounds (integer, 1..600)', () => {
    const withTimeout = (timeout: number) =>
      bashToolInputSchema.safeParse({ command: 'x', timeout }).success
    expect(withTimeout(1)).toBe(true)
    expect(withTimeout(600)).toBe(true)
    expect(withTimeout(0)).toBe(false)
    expect(withTimeout(601)).toBe(false)
    expect(withTimeout(1.5)).toBe(false)
  })

  test('accepts the full background-job shape', () => {
    const r = bashToolInputSchema.safeParse({
      command: 'npm run dev',
      cwd: '/work',
      description: 'dev server',
      background: true,
      notify: true,
    })
    expect(r.success).toBe(true)
  })

  test('rejects wrong field types', () => {
    expect(bashToolInputSchema.safeParse({ command: 'x', timeout: 'soon' }).success).toBe(false)
    expect(bashToolInputSchema.safeParse({ command: 'x', background: 'yes' }).success).toBe(false)
  })
})

describe('batch command security', () => {
  // Guards the regression where a batch (`commands[]`) bypassed the dangerous /
  // outside-workspace checks because only the single `command` was inspected.
  // The permission engine now scans EVERY command in the batch, so the safety
  // primitives must flag a dangerous/outside entry no matter its position.

  test('isDangerous flags a batch where any one command is dangerous', () => {
    const batch = ['echo a', 'rm -rf /', 'echo done']
    expect(batch.some(isDangerous)).toBe(true)
  })

  test('isDangerous passes a fully safe batch', () => {
    const batch = ['echo a', 'ls', 'cat x']
    expect(batch.some(isDangerous)).toBe(false)
  })

  test('outsideHomePathsInCommand catches a path in any single command (not the joined string)', () => {
    // The helper flags real user files under home that escape the workspace root —
    // anchor the escape under the actual home dir so isInsideWorkspace(home, …) holds.
    const home = os.homedir()
    const root = path.join(home, 'Documents', 'proj')
    const cwd = root
    const escape = path.join(home, 'other', 'secret.txt')
    const batch = ['echo a', `cat ${escape}`, 'echo c']
    const outside = batch.flatMap((c) => outsideHomePathsInCommand(c, root, cwd))
    expect(outside).toContain(escape)
  })

  test('outsideHomePathsInCommand returns nothing for a fully in-workspace batch', () => {
    const home = os.homedir()
    const root = path.join(home, 'Documents', 'proj')
    const cwd = root
    const batch = ['echo a', 'ls', 'cat x']
    const outside = batch.flatMap((c) => outsideHomePathsInCommand(c, root, cwd))
    expect(outside).toEqual([])
  })
})

describe('bashInputSchemaFor', () => {
  const keys = (s: ReturnType<typeof bashInputSchemaFor>) => Object.keys(s.shape)

  test('omits the interactive-PTY fields when the session has no terminalControl', () => {
    const k = keys(bashInputSchemaFor({ background: true, terminal: false }))
    expect(k).not.toContain('action')
    expect(k).not.toContain('terminal_id')
    expect(k).not.toContain('keys')
    expect(k).not.toContain('text')
    expect(k).not.toContain('wait_for_exit')
    expect(k).toContain('command')
  })

  test('keeps them when terminalControl is present', () => {
    const k = keys(bashInputSchemaFor({ background: true, terminal: true }))
    expect(k).toContain('action')
    expect(k).toContain('text')
    expect(k).toContain('wait_for_exit')
  })

  test('still gates background/notify on the background flag', () => {
    expect(keys(bashInputSchemaFor({ background: false, terminal: true }))).not.toContain(
      'background',
    )
    expect(keys(bashInputSchemaFor({ background: false, terminal: false }))).not.toContain('notify')
    expect(keys(bashInputSchemaFor({ background: true, terminal: false }))).toContain('background')
  })
})

/**
 * A shell for the batch tests below, answered at once: `echo <text>`, `fill <char> <bytes>` and
 * `exit <code>`, joined by `;`. What they pin is how a batch summarises, bounds and judges its
 * commands; spawning real shells only made them slow enough to time out on a busy machine.
 */
const scriptedShell = {
  exec: async (command: string) => {
    let stdout = ''
    for (const step of command.split(';').map((part) => part.trim())) {
      const [verb, ...args] = step.split(' ')
      if (verb === 'echo') stdout += `${args.join(' ')}\n`
      else if (verb === 'fill') stdout += args[0]!.repeat(Number(args[1]))
      else if (verb === 'exit') return { stdout, stderr: '', exitCode: Number(args[0]) }
    }
    return { stdout, stderr: '', exitCode: 0 }
  },
  readFile: async () => '',
  writeFile: async () => {},
  searchFiles: async () => '',
}

describe('bash batch summarizes keep_going failures', () => {
  const tool = createBashTool(scriptedShell as never, process.cwd())

  test('a failure among successes is named at the end, not left in the noise', async () => {
    const r = await tool.execute('b1', {
      commands: ['echo one', 'exit 3', 'echo three'],
      keep_going: true,
    })
    expect(r.content).toContain('three') // keep_going really ran the tail
    expect(r.content).toContain('1 of 3 command(s) failed (keep_going)')
    expect(r.content).toContain('exit 3')
  })

  test('an all-green batch gets no failure summary', async () => {
    const r = await tool.execute('b2', { commands: ['echo a', 'echo b'], keep_going: true })
    expect(r.content).not.toContain('keep_going)')
  })

  test('without keep_going the stop-early notice still explains the remainder', async () => {
    const r = await tool.execute('b3', { commands: ['exit 3', 'echo never'] })
    expect(r.content).toContain('1 remaining command(s) not run')
    expect(r.content).not.toContain('never')
  })
})

describe('bash batch isError semantics under keep_going', () => {
  const tool = createBashTool(scriptedShell as never, process.cwd())

  /**
   * bash's details are a discriminated union — a command result, or a terminal
   * screen when `action` dispatched to the interactive PTY path. A `commands:`
   * batch always takes the command path, so this narrows on the discriminant
   * rather than asserting the union away with a cast.
   */
  const commandDetails = (
    d: BashToolDetails | TerminalDetails | undefined,
  ): BashToolDetails | undefined => (d && !('action' in d) ? d : undefined)

  test('a partial failure is NOT a failed call — else 3 such turns trip the loop guard', async () => {
    const r = await tool.execute('k1', { commands: ['echo ok', 'exit 3'], keep_going: true })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('1 of 2 command(s) failed (keep_going)')
    // The card must still read as failed, with the real exit code.
    expect(commandDetails(r.details)?.jobStatus).toBe('failed')
    expect(commandDetails(r.details)?.exitCode).toBe(3)
  })

  test('a batch where NOTHING succeeded is still a failed call', async () => {
    const r = await tool.execute('k2', { commands: ['exit 3', 'exit 4'], keep_going: true })
    expect(r.isError).toBe(true)
  })

  test('without keep_going any failure is the call outcome', async () => {
    const r = await tool.execute('k3', { commands: ['echo ok', 'exit 3'] })
    expect(r.isError).toBe(true)
  })

  test('an all-green keep_going batch is clean', async () => {
    const r = await tool.execute('k4', { commands: ['echo a', 'echo b'], keep_going: true })
    expect(r.isError).toBeFalsy()
    expect(commandDetails(r.details)?.jobStatus).toBe('completed')
  })
})

/**
 * `timeout` bounds each command; nothing bounded the batch. Since the tool's description tells the
 * model to "Pass them ALL … in ONE call", `commands: [40 entries]` with `timeout: 600` was one tool
 * call allowed to hold the turn for four hours — and the stream has no overall turn timeout either,
 * only a 60s IDLE cap that a running command keeps resetting.
 */
describe('bash batch has a wall-clock budget', () => {
  /** An env that returns instantly but advances a FAKE clock, so 600s is testable in 0ms. */
  const fakeClockEnv = (secondsPerCommand: number) => {
    const ran: string[] = []
    let nowMs = 1_000_000
    const realNow = Date.now
    return {
      ran,
      install: () => {
        Date.now = () => nowMs
      },
      restore: () => {
        Date.now = realNow
      },
      env: {
        exec: async (command: string) => {
          ran.push(command)
          nowMs += secondsPerCommand * 1000
          return { stdout: 'ok', stderr: '', exitCode: 0 }
        },
        readFile: async () => '',
        writeFile: async () => {},
        searchFiles: async () => '',
      },
    }
  }

  test('stops starting commands once the budget is spent, and names what did not run', async () => {
    // 300s each: #1 starts at 0, #2 at 300 (still inside 600), #3 would start at 600 — refused.
    const clock = fakeClockEnv(300)
    clock.install()
    try {
      const tool = createBashTool(clock.env as never, process.cwd())
      const r = await tool.execute('budget-1', {
        commands: ['first', 'second', 'third', 'fourth'],
        keep_going: true,
      })
      expect(clock.ran).toEqual(['first', 'second'])
      expect(r.content).toContain('batch time budget of 600s reached after 2 command(s)')
      // The remainder is named, not just counted — the model has to know what to re-issue.
      expect(r.content).toContain('third, fourth')
      // Not an error: the commands that ran succeeded. Same rule the file applies to a partial
      // keep_going batch.
      expect(r.isError).toBeFalsy()
      // …but the CARD must not read "completed" while two commands never started.
      const details = r.details as BashToolDetails
      expect(details.jobStatus).toBe('timeout')
      expect(details.exitCode).toBe(124)
    } finally {
      clock.restore()
    }
  })

  test('a fast batch is untouched — the bound is time, not the number of commands', async () => {
    const clock = fakeClockEnv(1)
    clock.install()
    try {
      const tool = createBashTool(clock.env as never, process.cwd())
      const commands = Array.from({ length: 40 }, (_, i) => `step-${i}`)
      const r = await tool.execute('budget-2', { commands, keep_going: true })
      expect(clock.ran).toHaveLength(40)
      expect(r.content).not.toContain('batch time budget')
      expect((r.details as BashToolDetails).jobStatus).toBe('completed')
    } finally {
      clock.restore()
    }
  })

  test('the first command always runs, however long it took', async () => {
    // A single command is allowed to take the full 600s on its own, so the budget must never
    // refuse the command at index 0 — that would make a legal single-command batch impossible.
    const clock = fakeClockEnv(900)
    clock.install()
    try {
      const tool = createBashTool(clock.env as never, process.cwd())
      const r = await tool.execute('budget-3', { commands: ['slow', 'next'] })
      expect(clock.ran).toEqual(['slow'])
      expect(r.content).toContain('batch time budget')
    } finally {
      clock.restore()
    }
  })
})

/**
 * The AGGREGATE output budget for a batch.
 *
 * `MAX_OUTPUT_BYTES` and the tail cap bound ONE command; concatenating the blocks had no limit, so
 * the per-call bound only ever existed in the single-command shape. Measured before the budget, with
 * each block landing at ~51KB of model-facing text: 1 command → 51,475 bytes, 5 → 257,383,
 * 12 → 617,739 — and nothing caps the array length, so 40 → ~2MB in one tool result, re-sent every
 * turn until compaction.
 */
describe('bash batch bounds its TOTAL model-facing output', () => {
  const tool = createBashTool(scriptedShell as never, process.cwd())
  // ~150KB each: comfortably past the per-command cap, so every block is full-size.
  const noisy = (tag: string) => `echo ${tag}; fill x 150000`

  test("a small batch is untouched — every command's output is still there", async () => {
    const r = await tool.execute('bud-small', {
      commands: ['echo alpha', 'echo beta', 'echo gamma'],
    })
    expect(r.content).toContain('alpha')
    expect(r.content).toContain('beta')
    expect(r.content).toContain('gamma')
    // The budget must not announce itself for the case the tool actively encourages.
    expect(r.content).not.toContain('output budget')
  })

  test('a noisy batch stays bounded, and says what it dropped', async () => {
    const r = await tool.execute('bud-big', {
      commands: [noisy('c1'), noisy('c2'), noisy('c3'), noisy('c4'), noisy('c5'), noisy('c6')],
      keep_going: true,
    })
    expect(r.content.length).toBeLessThan(BATCH_OUTPUT_BUDGET_BYTES + 20_000)
    expect(r.content).toContain('output budget')
    expect(r.content).toContain('command(s) omitted')
  })

  test('every exit status survives the elision — that is what a batch is for', async () => {
    const r = await tool.execute('bud-status', {
      commands: [noisy('s1'), noisy('s2'), noisy('s3'), noisy('s4'), noisy('s5')],
      keep_going: true,
    })
    // One `$ <command>` header and one status per command, elided or not.
    expect(r.content.split('[ok,').length - 1).toBe(5)
  })

  test('a FAILED command keeps its output while successes are elided', async () => {
    // The failure sits LAST, after four noisy successes would already have spent the budget.
    const r = await tool.execute('bud-fail', {
      commands: [noisy('ok1'), noisy('ok2'), noisy('ok3'), noisy('ok4'), `fill y 150000; exit 7`],
      keep_going: true,
    })
    // Locate the failing command's OWN block. Asserting on a marker string would not work: the
    // keep_going summary line lists the failing command's TEXT, so any marker in the command echoes
    // there and the assertion passes even when the body was elided. (It did — that is why this
    // reads the block.)
    const failingBlock = r.content.split('\n\n').find((block) => block.includes('[exit 7,'))
    expect(failingBlock).toBeDefined()
    // "Which one failed and why" is the whole question a batch answers, so its body outranks the
    // successful blocks regardless of position.
    expect(failingBlock).not.toContain('output omitted')
    expect(failingBlock).toContain('yyy')
    // …and the successes it displaced really were elided.
    expect(r.content).toContain('output omitted (batch output budget spent)')
  })

  test('a one-command batch is never elided, however loud the command', async () => {
    // The per-command cap already holds ONE block near 51KB, so a lone command cannot reach the
    // batch budget — this pins that a single-entry batch behaves exactly like the single-command
    // path, which is the shape the budget must not disturb.
    const r = await tool.execute('bud-one', {
      commands: [`fill z 400000`],
    })
    expect(r.content).toContain('zzz')
    expect(r.content).not.toContain('output omitted')
  })

  test('the UI card is NOT elided — only what is re-sent to the model', async () => {
    // `modelFacingOutput`'s documented split: details.output keeps the wider raw cap.
    const r = await tool.execute('bud-ui', {
      commands: [noisy('u1'), noisy('u2'), noisy('u3'), noisy('u4'), noisy('u5'), noisy('u6')],
      keep_going: true,
    })
    const details = r.details as BashToolDetails
    expect(details.output.length).toBeGreaterThan(r.content.length)
    expect(details.output).not.toContain('output omitted (batch output budget spent)')
  })
})
