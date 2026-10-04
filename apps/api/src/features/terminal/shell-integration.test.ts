import { describe, expect, it, afterEach } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import {
  detectShellKind,
  bashInitScript,
  zshInitScript,
  installShellIntegration,
  cleanupShellIntegration,
} from './shell-integration'

describe('detectShellKind', () => {
  it('recognizes bash and zsh by basename', () => {
    expect(detectShellKind('/bin/bash')).toBe('bash')
    expect(detectShellKind('/usr/local/bin/zsh')).toBe('zsh')
    expect(detectShellKind('bash')).toBe('bash')
  })

  it('returns null for unknown / missing shells', () => {
    expect(detectShellKind('/bin/fish')).toBeNull()
    expect(detectShellKind('/usr/bin/pwsh')).toBeNull()
    expect(detectShellKind(undefined)).toBeNull()
    expect(detectShellKind('')).toBeNull()
  })
})

describe('rc script content', () => {
  it('bash script replays the login-shell startup, emits all four marks, and preserves $?', () => {
    const s = bashInitScript()
    // Login-shell parity: /etc/profile + the first profile file, exactly like a
    // local terminal's `bash -l` (--rcfile forces non-login, skipping these).
    expect(s).toContain('. /etc/profile')
    expect(s).toContain('. ~/.bash_profile')
    expect(s).toContain('. ~/.bash_login')
    expect(s).toContain('. ~/.profile')
    expect(s).toContain('. ~/.bashrc') // fallback when no profile file exists
    expect(s).toContain('133;%s') // the OSC 133 emitter
    expect(s).toContain('__lx_esc "C"') // command start
    expect(s).toContain('__lx_esc "D;$__ec"') // exit code marker
    expect(s).toContain('__lx_esc "A"')
    // B (input start) rides on PS1 (zero-width \[..\] suffix) so it fires where
    // the input actually begins — NOT in PROMPT_COMMAND (pre-prompt, column 0).
    expect(s).toContain('133;B')
    expect(s).toContain('PS1="${PS1}${__lx_b_mark}"')
    expect(s).not.toContain('__lx_esc "B"')
    expect(s).toContain('trap "__lx_preexec" DEBUG')
    // Idempotent: never double-registers into an existing PROMPT_COMMAND.
    expect(s).toContain('*__lx_prompt_command*')
  })

  it('zsh script sources the user config in login order, then adds hooks additively', () => {
    const s = zshInitScript()
    expect(s).toContain('LOCALIX_REAL_ZDOTDIR')
    // Login order: .zshenv → .zprofile → .zshrc … .zlogin at the very end.
    const order = ['.zshenv', '.zprofile', '.zshrc', 'add-zsh-hook', '.zlogin']
    const idx = order.map((n) => s.indexOf(n))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    // History repair: HISTFILE must never stay inside the throwaway ZDOTDIR.
    expect(s).toContain('HISTFILE="$__lx_zdotdir/.zsh_history"')
    expect(s).toContain('add-zsh-hook precmd __lx_precmd')
    expect(s).toContain('add-zsh-hook preexec __lx_preexec')
    expect(s).toContain('__lx_esc "D;$ec"')
    // B (input start) rides on PROMPT (zero-width %{..%} suffix) so it fires
    // where the input actually begins — NOT in precmd (pre-prompt, column 0).
    expect(s).toContain('133;B')
    expect(s).toContain('PROMPT="${PROMPT}${__lx_b_mark}"')
    expect(s).not.toContain('__lx_esc "B"')
  })
})

describe('installShellIntegration', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('returns null for an unsupported shell (plain shell fallback)', () => {
    expect(installShellIntegration('/bin/fish')).toBeNull()
    expect(installShellIntegration(undefined)).toBeNull()
  })

  it('writes a --rcfile injection for bash', () => {
    const inj = installShellIntegration('/bin/bash')
    expect(inj).not.toBeNull()
    dirs.push(inj!.dir)
    expect(inj!.shellArgs[0]).toBe('--rcfile')
    expect(inj!.shellArgs[1]).toContain(inj!.dir)
    expect(inj!.env).toEqual({})
    expect(Bun.file(inj!.shellArgs[1]).size).toBeGreaterThan(0)
  })

  it('writes a ZDOTDIR override for zsh and spawns it as a login shell', () => {
    const inj = installShellIntegration('/bin/zsh')
    expect(inj).not.toBeNull()
    dirs.push(inj!.dir)
    expect(inj!.shellArgs).toEqual(['-l'])
    expect(inj!.env.ZDOTDIR).toBe(inj!.dir)
    expect(inj!.env).toHaveProperty('LOCALIX_REAL_ZDOTDIR')
    expect(Bun.file(`${inj!.dir}/.zshrc`).size).toBeGreaterThan(0)
  })

  it('cleanupShellIntegration removes the temp dir and is safe to repeat', () => {
    const inj = installShellIntegration('/bin/bash')!
    expect(existsSync(inj.dir)).toBe(true) // the rc dir exists before cleanup...
    cleanupShellIntegration(inj.dir)
    // ...and is GONE after. This line used to read
    //   expect(Bun.file(inj.shellArgs[1]).size).resolves // no throw
    // — `.size` is a number, not a promise, and `.resolves` was never followed by a
    // matcher, so ZERO assertions ran. An empty cleanupShellIntegration body (leaking
    // the injected shell hooks and ZDOTDIR temp dir forever) passed this test.
    expect(existsSync(inj.dir)).toBe(false)
    // Second call on a gone dir is a no-op.
    expect(() => cleanupShellIntegration(inj.dir)).not.toThrow()
    expect(() => cleanupShellIntegration(undefined)).not.toThrow()
  })
})
