/* oxlint-disable no-control-regex -- this module parses/strips terminal ANSI escape + C0 control sequences; matching control chars in these regexes is the whole job */
/**
 * End-to-end proof that the injected rc actually makes a real shell emit OSC 133
 * marks through the Bun PTY backend — the exact prod path. Skipped when the shell
 * binary isn't present (CI images vary).
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Terminal } from '@xterm/headless'
import { bunPtyBackend } from './pty-bun'
import { installShellIntegration, cleanupShellIntegration } from './shell-integration'

/**
 * A shell these end-to-end runs can drive. zsh on a Linux runner is installed but unusable here:
 * Ubuntu's global zshrc runs compinit, which stops at an interactive security prompt before the
 * first prompt is painted, so both runs wait out their deadline. zsh is the macOS default shell
 * and is exercised there; bash covers the Linux path.
 */
const usableShell = (shell: string) =>
  existsSync(shell) && !(shell.endsWith('/zsh') && process.platform === 'linux')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait for a CONDITION, not a duration. These tests drive a real shell through a real
 * PTY, and fixed `sleep`s encoded "zsh paints its prompt within 600ms" — true on an idle
 * machine, false under the full suite (482 files in parallel), where zsh simply isn't
 * scheduled in time. The assertions below then failed on a starved shell rather than a
 * broken one, which is worse than useless: an intermittently red test teaches the next
 * reader to wave a REAL failure through. The cap keeps a genuinely broken shell failing.
 */
/**
 * An EMPTY home for the shell to start in.
 *
 * The injected rc deliberately sources the developer's real config — a local terminal must run
 * the user's shell, so that is correct for the product. It is wrong for this test, whose whole
 * subject is the OSC 133 marks OUR rc emits. Sourcing personal dotfiles adds no coverage and
 * makes the result depend on the machine.
 *
 * Measured on a developer machine here: an interactive `[oh-my-zsh] Would you like to update?
 * [Y/n]` at startup blocked the shell before it ever painted a prompt, so no mark was emitted
 * and the test spent its full 8s cap before failing. Any config that ASKS something at startup
 * does the same. With an empty home the first `B` arrives in ~14ms.
 */
function emptyHome(): string {
  return mkdtempSync(join(tmpdir(), 'lx-shell-home-'))
}

const waitUntil = async (cond: () => boolean, capMs = 8000): Promise<void> => {
  const deadline = Date.now() + capMs
  while (!cond() && Date.now() < deadline) await sleep(20)
}

async function runShell(shellPath: string): Promise<{ marks: string[]; raw: string }> {
  const inj = installShellIntegration(shellPath)!
  const fixtureHome = emptyHome()
  let out = ''
  const pty = bunPtyBackend.spawn({
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    shell: shellPath,
    shellArgs: inj.shellArgs,
    env: { ...inj.env, HOME: fixtureHome, LOCALIX_REAL_ZDOTDIR: fixtureHome },
  })
  pty.onData((d) => {
    out += d
  })
  const marks = () => [...out.matchAll(/\x1b\]133;([A-D0-9;]*)\x07/g)].map((m) => m[1])
  try {
    await waitUntil(() => marks().filter((mark) => mark === 'B').length >= 1)
    pty.write('echo hi\n')
    await waitUntil(() => marks().filter((mark) => mark === 'B').length >= 2)
    pty.write('false\n')
    await waitUntil(() => marks().includes('D;1'))
    return { marks: marks(), raw: out }
  } finally {
    pty.kill()
    cleanupShellIntegration(inj.dir)
    rmSync(fixtureHome, { recursive: true, force: true })
  }
}

/** Strip ANSI CSI/OSC sequences so only printable prompt/output text remains. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f]/g, '')
}

describe('a fresh prompt reads as EMPTY input through a VT emulator', () => {
  // Command extraction (exit-dot menu copy/rerun, sticky scroll, quick fixes)
  // derives the typed input from everything at/after the cursor column captured
  // at the OSC 133 `B` mark — so for a REAL shell the invariant is: when `B`
  // arrives, the cursor sits at the prompt's END (column > 0 with the new rc)
  // and the row holds NO printable text at or beyond that column. This replays
  // the exact PTY byte stream into @xterm/headless (the same engine the UI
  // renders with) and asserts that invariant at every `B` on an untouched prompt.
  for (const shell of ['/bin/bash', '/bin/zsh']) {
    it.skipIf(!usableShell(shell))(
      `${shell}: at B the cursor is at prompt end with nothing typed after it`,
      async () => {
        const inj = installShellIntegration(shell)!
        const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
        const atB: { col: number; textAfter: string }[] = []
        term.parser.registerOscHandler(133, (payload) => {
          if (payload === 'B') {
            const buf = term.buffer.active
            const row = buf.getLine(buf.baseY + buf.cursorY)
            atB.push({
              col: buf.cursorX,
              textAfter: row ? row.translateToString(true, buf.cursorX) : '',
            })
          }
          return false // observe only — don't swallow
        })
        const home = emptyHome()
        const pty = bunPtyBackend.spawn({
          cwd: process.cwd(),
          cols: 80,
          rows: 24,
          shell,
          shellArgs: inj.shellArgs,
          // HOME for bash's rc chain, LOCALIX_REAL_ZDOTDIR for zsh's — the injected rc reads the
          // latter to find the config it should source.
          env: { ...inj.env, HOME: home, LOCALIX_REAL_ZDOTDIR: home },
        })
        const writes: Promise<void>[] = []
        pty.onData((d) => {
          writes.push(new Promise<void>((r) => term.write(d, r)))
        })
        await waitUntil(() => atB.length >= 1) // first prompt
        pty.write('echo hi\n')
        // Second prompt (post-command — the proactive trigger point).
        await waitUntil(() => atB.length >= 2)
        pty.write('exit\n')
        await sleep(300)
        pty.kill()
        cleanupShellIntegration(inj.dir)
        await Promise.all(writes)
        term.dispose()

        // Both untouched prompts (startup + post-`echo hi`) fired B…
        expect(atB.length).toBeGreaterThanOrEqual(2)
        for (const b of atB.slice(0, 2)) {
          // …with the prompt already painted (input column NOT 0 — the old-rc bug)…
          expect(b.col).toBeGreaterThan(0)
          // …and nothing typed at/after the input column → the ghost gate reads ''.
          expect(b.textAfter.trim()).toBe('')
        }
      },
      8000,
    )
  }
})

describe('shell integration emits OSC 133 through the PTY', () => {
  for (const shell of ['/bin/bash', '/bin/zsh']) {
    it.skipIf(!usableShell(shell))(
      `${shell}: marks command boundaries + exit codes`,
      async () => {
        const { marks, raw } = await runShell(shell)
        // Command start marks for the two user commands.
        expect(marks.filter((m) => m === 'C').length).toBeGreaterThanOrEqual(2)
        // A successful command reports exit 0, a failed one exit 1.
        expect(marks).toContain('D;0')
        expect(marks).toContain('D;1')
        // B (input start) fires AFTER the prompt paints: the rendered prompt text
        // must sit BETWEEN an A mark and its B mark, so the terminal client anchors
        // the input column at the prompt's END (not column 0 — the bug that made
        // the AI ghost read the prompt itself as typed input).
        expect(marks).toContain('B')
        const between = /\x1b\]133;A\x07([\s\S]*?)\x1b\]133;B\x07/.exec(raw)
        expect(between).not.toBeNull()
        expect(stripAnsi(between![1]).trim().length).toBeGreaterThan(0)
      },
      5000,
    )
  }
})

/**
 * Run one interactive shell in an ISOLATED fake HOME (no user config → the
 * system files drive the defaults, exactly the setup where the history bug
 * bit), feed it `lines`, exit cleanly, and return the stripped transcript.
 */
async function runInFakeHome(shell: string, home: string, lines: string[]): Promise<string> {
  const inj = installShellIntegration(shell)!
  let out = ''
  const pty = bunPtyBackend.spawn({
    cwd: home,
    cols: 120,
    rows: 30,
    shell,
    shellArgs: inj.shellArgs,
    // The fake HOME must also be what the rc re-sources as the "real" zdotdir.
    // Ubuntu's global zshrc runs compinit and can stop at an interactive security prompt when the
    // hosted runner has group-writable completion directories. That prompt is unrelated to the
    // history contract and consumes the commands below, so use the distro-supported opt-out in
    // this isolated test shell only.
    env: {
      ...inj.env,
      HOME: home,
      LOCALIX_REAL_ZDOTDIR: home,
      skip_global_compinit: '1',
    },
  })
  pty.onData((d) => {
    out += d
  })
  const exited = new Promise<void>((r) => pty.onExit(() => r()))
  await sleep(700)
  for (const line of lines) {
    pty.write(`${line}\n`)
    await sleep(350)
  }
  pty.write('exit\n')
  await Promise.race([exited, sleep(1500)])
  pty.kill()
  cleanupShellIntegration(inj.dir)
  return stripAnsi(out)
}

describe('shell HISTORY behaves like a local terminal (the "terminal has no history" bug)', () => {
  // Root cause (zsh): macOS /etc/zshrc sets HISTFILE=${ZDOTDIR:-$HOME}/… and
  // runs BEFORE our injected $ZDOTDIR/.zshrc — with ZDOTDIR overridden to the
  // throwaway shell-integration temp dir, history was written there (deleted on
  // session end) and ~/.zsh_history was never loaded. Plus the PTY spawned a
  // NON-login zsh, skipping .zprofile/.zlogin. These tests run against the REAL
  // /bin/zsh with an isolated fake HOME.
  it.skipIf(!existsSync('/bin/zsh'))(
    'zsh: loads a pre-existing ~/.zsh_history and is a login shell',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'lx-hist-home-'))
      try {
        writeFileSync(join(home, '.zsh_history'), 'echo from-a-previous-terminal\n')
        const out = await runInFakeHome('/bin/zsh', home, [
          'echo LOGIN=$options[login] HF=$HISTFILE',
          'fc -l 1',
        ])
        // Login shell (local-terminal parity) …
        expect(out).toContain('LOGIN=on')
        // … HISTFILE repaired to the REAL home, not the temp ZDOTDIR …
        expect(out).toContain(`HF=${join(home, '.zsh_history')}`)
        // … and the pre-existing history is actually LOADED (what up-arrow and
        // zsh-autosuggestions read).
        expect(out).toContain('from-a-previous-terminal')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
    10000,
  )

  it.skipIf(!existsSync('/bin/zsh'))(
    'zsh: history persists across sessions (run → exit → new terminal sees it)',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'lx-hist-home-'))
      try {
        await runInFakeHome('/bin/zsh', home, ['echo remember-me-across-sessions'])
        // The first session wrote its history to the real home on exit…
        expect(readFileSync(join(home, '.zsh_history'), 'utf8')).toContain(
          'remember-me-across-sessions',
        )
        // …and a brand-new session loads it.
        const out = await runInFakeHome('/bin/zsh', home, ['fc -l 1'])
        expect(out).toContain('remember-me-across-sessions')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
    15000,
  )

  it.skipIf(!existsSync('/bin/bash'))(
    'bash: HISTFILE stays the real ~/.bash_history under --rcfile',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'lx-hist-home-'))
      try {
        const out = await runInFakeHome('/bin/bash', home, ['echo HF=$HISTFILE'])
        expect(out).toContain(`HF=${join(home, '.bash_history')}`)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
    10000,
  )
})
