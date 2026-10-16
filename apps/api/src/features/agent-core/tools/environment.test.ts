import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalEnvironment } from './environments/local'
import { SSHEnvironment, DockerEnvironment } from './environments/remote'
import { createEnvironment } from './environments'
import { shellQuote, interpretRipgrep } from './environment'

// ---------------------------------------------------------------------------
// LocalEnvironment
// ---------------------------------------------------------------------------

describe('LocalEnvironment', () => {
  let tmpDir: string
  let env: LocalEnvironment

  beforeEach(async () => {
    tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'env-test-')))
    env = new LocalEnvironment()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('config.kind is local', () => {
    expect(env.config.kind).toBe('local')
  })

  it('writeFile creates file and readFile reads it back', async () => {
    const filePath = join(tmpDir, 'hello.txt')
    await env.writeFile(filePath, 'hello world')
    const content = await env.readFile(filePath)
    expect(content).toBe('hello world')
  })

  it('writeFile creates nested parent directories', async () => {
    const filePath = join(tmpDir, 'a', 'b', 'c.txt')
    await env.writeFile(filePath, 'nested')
    const content = await env.readFile(filePath)
    expect(content).toBe('nested')
  })

  it('readFile throws for non-existent file', () => {
    expect(env.readFile(join(tmpDir, 'missing.txt'))).rejects.toThrow()
  })

  it('exec returns stdout', async () => {
    const result = await env.exec('echo hello')
    expect(result.stdout.trim()).toBe('hello')
    expect(result.exitCode).toBe(0)
  })

  it('does not stall when a command backgrounds a child that holds stdout', async () => {
    // `sleep 5 &` orphans a child holding the inherited stdout pipe, so 'close'
    // never fires — without the exit-grace this would block ~5s (or until timeout).
    const t0 = Date.now()
    const result = await env.exec('sleep 5 & echo started', { timeout: 30 })
    const elapsed = Date.now() - t0
    expect(result.stdout).toContain('started')
    expect(result.exitCode).toBe(0)
    expect(elapsed).toBeLessThan(3000) // returns on exit (+250ms grace), not after 5s
  })

  it('exec returns stderr separately', async () => {
    const result = await env.exec('echo err >&2')
    expect(result.stderr.trim()).toBe('err')
  })

  it('exec returns non-zero exitCode on failure', async () => {
    const result = await env.exec('exit 42')
    expect(result.exitCode).toBe(42)
  })

  it('exec respects cwd option', async () => {
    const result = await env.exec('pwd', { cwd: tmpDir })
    expect(result.stdout.trim()).toBe(tmpDir)
  })

  it('exec respects timeout and returns exitCode 124', async () => {
    const result = await env.exec('sleep 60', { timeout: 1 })
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('Timed out')
  }, 5000)

  it('searchFiles returns matching lines', async () => {
    await env.writeFile(join(tmpDir, 'foo.ts'), 'const x = 1\nconst y = 2\n')
    await env.writeFile(join(tmpDir, 'bar.ts'), 'const z = 3\n')
    const output = await env.searchFiles('const', tmpDir)
    expect(output).toContain('foo.ts')
    expect(output).toContain('bar.ts')
  })

  it('searchFiles context prints surrounding lines, marked with "-" not ":"', async () => {
    // Lets the model judge a hit in place; 570 of 1259 post-search reads in the
    // recorded corpus pulled the WHOLE file just to see the lines around a match.
    await env.writeFile(join(tmpDir, 'ctx.ts'), 'line1\nline2\nNEEDLE\nline4\nline5\n')
    const plain = await env.searchFiles('NEEDLE', tmpDir)
    expect(plain).not.toContain('line2')

    const withCtx = await env.searchFiles('NEEDLE', tmpDir, { context: 1 })
    expect(withCtx).toContain('NEEDLE')
    expect(withCtx).toContain('line2')
    expect(withCtx).toContain('line4')
    expect(withCtx).not.toContain('line5')
    expect(withCtx).toMatch(/ctx\.ts-2-line2/)
  })

  it('searchFiles auto-enables multiline for patterns containing \\n', async () => {
    await env.writeFile(join(tmpDir, 'multi.ts'), 'alpha\nbeta\ngamma\n')
    const output = await env.searchFiles('alpha\\nbeta', tmpDir)
    expect(output).toContain('multi.ts')
  })

  it('searchFiles respects glob filter', async () => {
    await env.writeFile(join(tmpDir, 'foo.ts'), 'hello typescript\n')
    await env.writeFile(join(tmpDir, 'foo.js'), 'hello javascript\n')
    const output = await env.searchFiles('hello', tmpDir, { glob: '*.ts' })
    expect(output).toContain('foo.ts')
    expect(output).not.toContain('foo.js')
  })
})

// ---------------------------------------------------------------------------
// SSHEnvironment — command shape (no real SSH; just inspect config)
// ---------------------------------------------------------------------------

describe('SSHEnvironment', () => {
  it('stores host and default port', () => {
    const env = new SSHEnvironment({ kind: 'ssh', sshHost: 'user@example.com' })
    expect(env.config.sshHost).toBe('user@example.com')
    expect(env.config.sshPort).toBeUndefined()
  })

  it('stores custom port', () => {
    const env = new SSHEnvironment({ kind: 'ssh', sshHost: 'user@host', sshPort: 2222 })
    expect(env.config.sshPort).toBe(2222)
  })

  it('throws when constructed with wrong kind', () => {
    expect(() => new SSHEnvironment({ kind: 'local' } as any)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// DockerEnvironment — command shape
// ---------------------------------------------------------------------------

describe('DockerEnvironment', () => {
  it('stores container name', () => {
    const env = new DockerEnvironment({ kind: 'docker', containerName: 'myapp' })
    expect(env.config.containerName).toBe('myapp')
  })

  it('throws when constructed with wrong kind', () => {
    expect(() => new DockerEnvironment({ kind: 'local' } as any)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// createEnvironment factory
// ---------------------------------------------------------------------------

describe('createEnvironment', () => {
  it('returns LocalEnvironment for kind=local', () => {
    const env = createEnvironment({ kind: 'local' })
    expect(env.config.kind).toBe('local')
  })

  it('returns SSHEnvironment for kind=ssh', () => {
    const env = createEnvironment({ kind: 'ssh', sshHost: 'user@host' })
    expect(env.config.kind).toBe('ssh')
  })

  it('returns DockerEnvironment for kind=docker', () => {
    const env = createEnvironment({ kind: 'docker', containerName: 'c1' })
    expect(env.config.kind).toBe('docker')
  })
})

describe('interpretRipgrep', () => {
  it('exit 0 → returns stdout (matches)', () => {
    expect(interpretRipgrep({ stdout: 'foo.ts:1:hit', stderr: '', exitCode: 0 })).toBe(
      'foo.ts:1:hit',
    )
  })

  it('exit 1 → returns empty string (no matches, not an error)', () => {
    expect(interpretRipgrep({ stdout: '', stderr: '', exitCode: 1 })).toBe('')
  })

  it('exit 2 WITH matches → returns partial stdout (one unreadable subdir must not void the whole search)', () => {
    // The live failure: rg found matches but hit a macOS-protected dir and exited 2.
    const out = interpretRipgrep({
      stdout: 'foo.ts:1:hit\nbar.ts:2:hit',
      stderr: 'rg: ./Library/Caches/com.apple.ap.adprivacyd: Operation not permitted (os error 1)',
      exitCode: 2,
    })
    expect(out).toBe('foo.ts:1:hit\nbar.ts:2:hit')
  })

  it('exit 2 with NO stdout → throws the stderr reason (bad regex, missing rg, unreadable root)', () => {
    expect(() =>
      interpretRipgrep({ stdout: '', stderr: 'rg: regex parse error', exitCode: 2 }),
    ).toThrow('regex parse error')
  })

  it('exit 2 with neither stdout nor stderr → throws a generic message', () => {
    expect(() => interpretRipgrep({ stdout: '   ', stderr: '', exitCode: 2 })).toThrow(
      'exit code 2',
    )
  })
})

describe('shellQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellQuote('abc')).toBe("'abc'")
    expect(shellQuote('a b/c.ts')).toBe("'a b/c.ts'")
    expect(shellQuote('')).toBe("''")
  })

  it('escapes embedded single quotes with the close-literal-reopen pattern', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('neutralizes shell metacharacters by keeping them inside the quotes', () => {
    // Everything stays one literal arg — no unescaped quote can break out to start a command.
    const out = shellQuote("'; rm -rf / #")
    expect(out.startsWith("'")).toBe(true)
    expect(out.endsWith("'")).toBe(true)
    // The only way a literal ' appears is as the escaped sequence '\'' — never a bare,
    // quote-closing ' followed by shell syntax.
    expect(out.replace(/'\\''/g, '')).not.toContain("' ") // no bare close-quote then a token
    expect(out).toBe("''\\''; rm -rf / #'")
  })
})
