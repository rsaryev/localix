import { describe, it, expect } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderPluginPrompt, parsePluginCommandArgs } from './plugin-commands'
import type { PluginCommand } from '../../plugins/contracts'

const cmd = (args: unknown[]): PluginCommand =>
  ({ name: 'demo', prompt: '', args }) as unknown as PluginCommand

describe('parsePluginCommandArgs', () => {
  it('a final text arg greedily captures the rest', () => {
    const r = parsePluginCommandArgs(
      cmd([{ name: 'msg', type: 'text', required: true }]),
      'hello there world',
    )
    expect(r).toEqual({ values: { msg: 'hello there world' } })
  })

  it('a missing required arg → a usage message', () => {
    const r = parsePluginCommandArgs(cmd([{ name: 'msg', type: 'text', required: true }]), '   ')
    expect('usage' in r && r.usage).toContain('Missing required argument')
  })

  it('an optional final text arg may be empty', () => {
    expect(
      parsePluginCommandArgs(cmd([{ name: 'msg', type: 'text', required: false }]), ''),
    ).toEqual({ values: { msg: '' } })
  })

  it('a choice arg accepts a valid option and feeds the rest to a trailing text arg', () => {
    const command = cmd([
      {
        name: 'mode',
        type: 'choice',
        required: true,
        options: [{ value: 'fast' }, { value: 'slow' }],
      },
      { name: 'task', type: 'text', required: true },
    ])
    expect(parsePluginCommandArgs(command, 'fast build the parser')).toEqual({
      values: { mode: 'fast', task: 'build the parser' },
    })
  })

  it('an invalid required choice → a usage message listing the options', () => {
    const command = cmd([
      {
        name: 'mode',
        type: 'choice',
        required: true,
        options: [{ value: 'fast' }, { value: 'slow' }],
      },
    ])
    const r = parsePluginCommandArgs(command, 'turbo')
    expect('usage' in r && r.usage).toContain('must be one of')
    expect('usage' in r && r.usage).toContain('fast')
  })
})

describe('renderPluginPrompt', () => {
  it('substitutes declared ${argName} placeholders', async () => {
    expect(await renderPluginPrompt('Search for ${query}.', { query: 'cats' })).toBe(
      'Search for cats.',
    )
  })

  it('renders an unknown ${argName} as empty', async () => {
    expect(await renderPluginPrompt('A ${missing} B', {})).toBe('A  B')
  })

  it('substitutes Claude Code $ARGUMENTS with the full raw arg string', async () => {
    expect(await renderPluginPrompt('Deploy $ARGUMENTS to prod.', {}, 'web staging')).toBe(
      'Deploy web staging to prod.',
    )
  })

  it('substitutes $ARGUMENTS[N] and the $N shorthand (0-based)', async () => {
    expect(await renderPluginPrompt('Migrate $0 from $1 to $2.', {}, 'SearchBar React Vue')).toBe(
      'Migrate SearchBar from React to Vue.',
    )
    expect(await renderPluginPrompt('First is $ARGUMENTS[0].', {}, 'alpha beta')).toBe(
      'First is alpha.',
    )
  })

  it('honors shell-style quoting for indexed tokens', async () => {
    expect(await renderPluginPrompt('Got $0 then $1.', {}, '"hello world" second')).toBe(
      'Got hello world then second.',
    )
  })

  it('renders an out-of-range index as empty', async () => {
    expect(await renderPluginPrompt('Only $5 here.', {}, 'one two')).toBe('Only  here.')
  })

  it('leaves a backslash-escaped token literal', async () => {
    expect(await renderPluginPrompt('Price is \\$1.00 today.', {}, 'ignored')).toBe(
      'Price is $1.00 today.',
    )
  })

  it('combines declared placeholders and CC tokens', async () => {
    expect(
      await renderPluginPrompt('${verb} all of $ARGUMENTS now', { verb: 'Build' }, 'a b c'),
    ).toBe('Build all of a b c now')
  })

  it('fills $name from CC `arguments` by position, and from a declared arg by value', async () => {
    expect(
      await renderPluginPrompt('Deploy $app to $env.', {}, 'web staging', {
        arguments: ['app', 'env'],
      }),
    ).toBe('Deploy web to staging.')
    expect(await renderPluginPrompt('Scope: $scope', { scope: 'branch' }, 'branch main')).toBe(
      'Scope: branch',
    )
  })

  it('a longer name is not eaten by a shorter one, and \\$name stays literal', async () => {
    expect(await renderPluginPrompt('$a/$ab \\$a', {}, 'x y', { arguments: ['a', 'ab'] })).toBe(
      'x/y $a',
    )
  })

  it('appends raw input when the template has no argument placeholder', async () => {
    expect(await renderPluginPrompt('Do the task carefully.', {}, 'IMPORTANT USER ARG')).toBe(
      'Do the task carefully.\n\nArguments: IMPORTANT USER ARG',
    )
  })

  it('still appends raw input when the template only has an environment placeholder', async () => {
    expect(
      await renderPluginPrompt('Project: ${CLAUDE_PROJECT_DIR}', {}, 'review src', {
        projectDir: '/repo',
      }),
    ).toBe('Project: /repo\n\nArguments: review src')
  })

  it('does not append raw input twice when a declared placeholder consumes it', async () => {
    expect(await renderPluginPrompt('Review ${target}.', { target: 'src' }, 'src')).toBe(
      'Review src.',
    )
  })

  it('does NOT run dynamic content without a cwd (backwards-compatible pure render)', async () => {
    // Without ctx.cwd the `!`cmd`` / `@path` stage is skipped — text passes through raw.
    expect(await renderPluginPrompt('echo test: !`echo hi`', {})).toBe('echo test: !`echo hi`')
  })

  it('substitutes ${CLAUDE_WEBHOOK_URL} with this instance’s inbound-webhook URL', async () => {
    const out = await renderPluginPrompt('POST to ${CLAUDE_WEBHOOK_URL} to report.', {})
    expect(out).toMatch(/^POST to https?:\/\/.+\/rpc\/webhook\/messages to report\.$/)
  })
})

describe('renderPluginPrompt CC dynamic content (cwd provided)', () => {
  it('executes an inline !`cmd` bash-embed', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'localix-cmd-'))
    const out = await renderPluginPrompt('Status: !`echo alive`', {}, '', { cwd: dir })
    expect(out).toBe('Status: alive')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('inlines an @path file reference, confined + fenced', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'localix-ref-'))
    await fs.writeFile(join(dir, 'notes.txt'), 'line one\nline two')
    const out = await renderPluginPrompt('Context:\n@notes.txt\nEnd.', {}, '', { cwd: dir })
    expect(out).toContain('``` notes.txt')
    expect(out).toContain('line one')
    expect(out).toContain('line two')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('leaves an @path that escapes the cwd / is missing verbatim', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'localix-ref2-'))
    const out = await renderPluginPrompt('See @../secret.txt and @nope.txt', {}, '', { cwd: dir })
    expect(out).toBe('See @../secret.txt and @nope.txt')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('does NOT execute a shell embed that arrives via a user ${arg} value (no render-time injection)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'localix-inj-'))
    const marker = join(dir, 'pwned.txt')
    // A malicious task arg carrying an inline embed + an @path reference.
    const task = 'do stuff !`echo PWNED > ' + marker + '` and @notes.txt'
    await fs.writeFile(join(dir, 'notes.txt'), 'SECRET')
    const out = await renderPluginPrompt('Task:\n${task}\nEnd.', { task }, '', { cwd: dir })
    // The embed sequence must survive verbatim — NOT executed, NOT inlined.
    expect(out).toContain('!`echo PWNED')
    expect(out).toContain('@notes.txt')
    expect(out).not.toContain('SECRET')
    // The side-effect file must never have been created.
    expect(fs.access(marker)).rejects.toThrow()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('still executes a TEMPLATE-authored embed even when args are present', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'localix-tmpl-'))
    const out = await renderPluginPrompt('Hi ${who}: !`echo alive`', { who: 'bob' }, '', {
      cwd: dir,
    })
    expect(out).toBe('Hi bob: alive')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
