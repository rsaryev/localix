import { describe, expect, test } from 'bun:test'
import { createBashTool, isReadOnlyCommand } from './bash'

describe('isReadOnlyCommand', () => {
  test('allows read-only inspection commands', () => {
    for (const c of [
      'ls -la',
      'cat package.json',
      'grep -r foo src',
      'rg "pattern" .',
      'find . -name "*.ts"',
      'git status',
      'git log --oneline',
      'git diff HEAD~1',
      'git stash list',
      'git stash show',
      'git config --get user.name',
      'git config --list',
      'git config user.email',
      'npm ls',
      'cat a.txt | grep x | head -5',
      'pwd && ls',
      'bun --version',
      'node -v',
      'python3 -V',
      'ls -la && echo "---bun---" && which bun && bun --version 2>/dev/null || echo "bun not found"',
    ]) {
      expect(isReadOnlyCommand(c)).toBe(true)
    }
  })

  test('rejects mutating / write / install commands', () => {
    for (const c of [
      'node -v app.js',
      'bun run build',
      'npm create vite@latest . -- --template react',
      'npm install react',
      'rm -rf node_modules',
      'mkdir foo',
      'echo hi > file.txt',
      'cat a >> b',
      'git commit -m x',
      'git push',
      'git stash',
      'git stash push -m wip',
      'git stash pop',
      'git config user.name "Bob"',
      'git config --global user.email a@b.c',
      'git config --unset user.name',
      'sed -i "s/a/b/" f.txt',
      'touch new.ts',
      'mv a b',
      'tee out.txt',
    ]) {
      expect(isReadOnlyCommand(c)).toBe(false)
    }
  })

  test('allows fd-dup redirect but blocks file redirect', () => {
    expect(isReadOnlyCommand('grep x f 2>&1')).toBe(true)
    expect(isReadOnlyCommand('grep x f > out')).toBe(false)
  })

  test('allows redirects to /dev/null (no-op sink) but not real files or devices', () => {
    // Regression: the `… 2>/dev/null` idiom used during investigation was wrongly blocked.
    expect(isReadOnlyCommand('ls -la /tmp/x 2>/dev/null || echo "missing"')).toBe(true)
    expect(isReadOnlyCommand('ls -la 2>/dev/null')).toBe(true)
    expect(isReadOnlyCommand('grep x file 2>/dev/null || true')).toBe(true)
    expect(isReadOnlyCommand('cat foo > /dev/null')).toBe(true)
    // A real file target or device write must still be rejected.
    expect(isReadOnlyCommand('cat foo > /dev/sda')).toBe(false)
    expect(isReadOnlyCommand('echo hi > realfile.txt')).toBe(false)
  })

  test('unknown command head is treated as mutating (fail-closed)', () => {
    expect(isReadOnlyCommand('somerandomtool --do-stuff')).toBe(false)
  })

  test('respects quoting: a redirect char inside quotes is not a redirect', () => {
    expect(isReadOnlyCommand('echo "a > b"')).toBe(true)
    expect(isReadOnlyCommand('grep "x > y" file')).toBe(true)
  })

  test('blocks dangerous find/sed variants and subshells', () => {
    expect(isReadOnlyCommand('find . -name x -delete')).toBe(false)
    expect(isReadOnlyCommand('find . -exec rm {} ;')).toBe(false)
    expect(isReadOnlyCommand('sed -i s/a/b/ f')).toBe(false)
    expect(isReadOnlyCommand('(rm -rf x)')).toBe(false)
  })
})

describe('bash reports mutation per call', () => {
  const run = async (input: Record<string, unknown>) => {
    const tool = createBashTool()
    return (await tool.execute('t1', input as never)) as { mutated?: boolean; content: string }
  }

  test('a read-only command reports mutated:false so the exploration guard keeps counting', async () => {
    // `bash` stays statically `mutates: true` (it can `rm -rf`); only the CALL is clean.
    const r = await run({ command: 'echo hello', description: 'Echo' })
    expect(r.mutated).toBe(false)
  })

  test('a mutating command leaves the static flag alone', async () => {
    // `touch` is not a read-only head; harmless to actually run in the test cwd.
    const r = await run({ command: 'touch probe-mutation.txt', description: 'Touch a file' })
    expect(r.mutated).toBeUndefined()
  })

  test('a batch is read-only only when EVERY command is', async () => {
    const clean = await run({ commands: ['echo a', 'echo b'], description: 'Echo twice' })
    expect(clean.mutated).toBe(false)
    const dirty = await run({
      commands: ['echo a', 'touch probe-mutation.txt'],
      description: 'Echo then touch',
    })
    expect(dirty.mutated).toBeUndefined()
  })
})
