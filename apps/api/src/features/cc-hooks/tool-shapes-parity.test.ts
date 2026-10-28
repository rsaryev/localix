/**
 * What a Claude Code hook script reads for each Localix tool, against hooks.md's PreToolUse input
 * tables and the tools' result shapes: the hook runs as a real process and its stdin is checked.
 * A hook that reads `tool_input.command`, `tool_input.file_path`, `tool_input.subagent_type` or
 * `tool_response.filePath` must find them whichever shape the model called the tool in.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { createCcHooksRuntime } from './run'

const dir = tempDirPerTest('cc-tool-shapes-')
const silent = { warn: () => {}, info: () => {} }

const spy = (label: string): CcHookHandler => ({
  source: 'user',
  command: `cat > "${dir()}/${label}.json"`,
  timeoutMs: 5000,
})
const seen = (label: string) => JSON.parse(readFileSync(join(dir(), `${label}.json`), 'utf8'))

const runtime = (groups: CcHookRegistry) =>
  createCcHooksRuntime({
    registry: groups,
    sessionId: 'sess-1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

const pre = (matcher: string) => runtime({ PreToolUse: [{ matcher, handlers: [spy('pre')] }] })
const post = (matcher: string) => runtime({ PostToolUse: [{ matcher, handlers: [spy('post')] }] })

describe('PreToolUse tool_input in Claude Code’s shape', () => {
  it('a batch of shell commands reaches a Bash hook as one command line', async () => {
    await pre('Bash').runPreToolUse('Bash', { commands: ['rm -rf build', 'ls'], background: true })
    expect(seen('pre')).toMatchObject({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build && ls', run_in_background: true },
    })
  })

  it('a file listing is Glob and a content search is Grep, with Claude Code’s fields', async () => {
    await pre('Glob').runPreToolUse('Search', { glob: '**/*.ts' })
    expect(seen('pre')).toMatchObject({ tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } })
    await pre('Grep').runPreToolUse('Search', { query: 'TODO', path: 'src', context: 2 })
    expect(seen('pre')).toMatchObject({
      tool_name: 'Grep',
      tool_input: { pattern: 'TODO', path: join(dir(), 'src'), output_mode: 'content', '-C': 2 },
    })
  })

  it('a line range reads as Read’s offset and limit, not the byte offset', async () => {
    await pre('Read').runPreToolUse('Read', { path: 'a.ts', start_line: 10, end_line: 19 })
    expect(seen('pre').tool_input).toMatchObject({
      file_path: join(dir(), 'a.ts'),
      offset: 10,
      limit: 10,
    })
    await pre('Read').runPreToolUse('Read', { path: 'a.ts', offset: 4096 })
    expect(seen('pre').tool_input.offset).toBeUndefined()
  })

  it('a file path resolves against the call’s own cwd', async () => {
    const edit = { edits: [{ path: 'b.ts', old_string: 'x', new_string: 'y' }], cwd: 'pkg' }
    await pre('Edit').runPreToolUse('Edit', edit)
    expect(seen('pre').tool_input.file_path).toBe(join(dir(), 'pkg', 'b.ts'))
  })

  it('Agent is Agent, skill is Skill, research of a URL is WebFetch', async () => {
    await pre('Agent').runPreToolUse('Agent', {
      prompt: 'Find endpoints',
      subagent_type: 'Explore',
    })
    expect(seen('pre')).toMatchObject({
      tool_name: 'Agent',
      tool_input: { prompt: 'Find endpoints', subagent_type: 'Explore' },
    })
    await pre('Skill').runPreToolUse('Skill', { action: 'get', name: 'deploy', arguments: 'prod' })
    expect(seen('pre')).toMatchObject({
      tool_name: 'Skill',
      tool_input: { skill: 'deploy', args: 'prod' },
    })
    await pre('WebFetch').runPreToolUse('Research', {
      question: 'What changed?',
      urls: ['https://example.com/notes'],
    })
    expect(seen('pre')).toMatchObject({
      tool_name: 'WebFetch',
      tool_input: { url: 'https://example.com/notes', prompt: 'What changed?' },
    })
  })

  it('a question card reads as AskUserQuestion’s header and multiSelect', async () => {
    const question = { id: 'lib', question: 'Which?', options: [{ label: 'A' }], multi: true }
    await pre('AskUserQuestion').runPreToolUse('AskUserQuestion', { questions: [question] })
    expect(seen('pre').tool_input.questions[0]).toMatchObject({
      question: 'Which?',
      header: 'lib',
      multiSelect: true,
      options: [{ label: 'A' }],
    })
  })
})

describe('PostToolUse tool_response in Claude Code’s shape', () => {
  const diff = ['--- a.ts', '+++ a.ts', '@@ -1,1 +1,1 @@', '-x', '+y', ''].join('\n')

  it('an edit answers with filePath, oldString, newString and structuredPatch', async () => {
    const input = { edits: [{ path: 'a.ts', old_string: 'x', new_string: 'y' }] }
    const details = { cwd: dir(), files: [{ path: 'a.ts', diff, replacements: 1 }] }
    await post('Edit').runPostToolUse('Edit', input, { content: 'Edited a.ts', details }, 'e1')
    expect(seen('post').tool_response).toEqual({
      filePath: join(dir(), 'a.ts'),
      oldString: 'x',
      newString: 'y',
      originalFile: null,
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] },
      ],
      userModified: false,
      replaceAll: false,
    })
  })

  it('a write answers with type create and the content written', async () => {
    const input = { files: [{ path: 'n.md', content: 'hi' }] }
    const details = { cwd: dir(), files: [{ path: 'n.md', created: true }] }
    await post('Write').runPostToolUse('Write', input, { content: 'Wrote n.md', details }, 'w1')
    expect(seen('post').tool_response).toMatchObject({
      type: 'create',
      filePath: join(dir(), 'n.md'),
      content: 'hi',
    })
  })

  it('a read answers with the text file record', async () => {
    const details = { path: 'a.ts', bytes: 4, truncated: false, output: 'a\nb\n' }
    await post('Read').runPostToolUse('Read', { path: 'a.ts' }, { content: 'a\nb\n', details })
    expect(seen('post').tool_response).toEqual({
      type: 'text',
      file: {
        filePath: join(dir(), 'a.ts'),
        content: 'a\nb\n',
        numLines: 2,
        startLine: 1,
        totalLines: 2,
      },
    })
  })

  it('a file listing answers as Glob’s filenames', async () => {
    const details = { query: '', cwd: dir(), glob: '*.ts', bytes: 8, truncated: false }
    const result = { content: 'a.ts\nb.ts', details: { ...details, output: 'a.ts\nb.ts\n' } }
    await post('Glob').runPostToolUse('Search', { glob: '*.ts' }, result)
    expect(seen('post').tool_response).toMatchObject({
      filenames: ['a.ts', 'b.ts'],
      numFiles: 2,
      truncated: false,
    })
  })
})

describe('the call’s id and duration', () => {
  it('PostToolUseFailure carries tool_use_id and duration_ms, PostToolUse duration_ms', async () => {
    const failure = { PostToolUseFailure: [{ handlers: [spy('fail')] }] }
    await runtime(failure).runPostToolUseFailure(
      'Bash',
      { command: 'false' },
      { error: 'Exit code 1', isInterrupt: false, durationMs: 12 },
      'f-1',
    )
    expect(seen('fail')).toMatchObject({ tool_use_id: 'f-1', duration_ms: 12 })
    const details = { command: 'true', cwd: dir(), output: '', isStreaming: false }
    await post('Bash').runPostToolUse(
      'Bash',
      { command: 'true' },
      { content: '', details },
      'p-1',
      7,
    )
    expect(seen('post')).toMatchObject({ tool_use_id: 'p-1', duration_ms: 7 })
  })
})

describe('PostToolBatch', () => {
  it('lists each call with its file path absolute', async () => {
    const rt = runtime({ PostToolBatch: [{ handlers: [spy('batch')] }] })
    const call = { tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_use_id: 'r1' }
    await rt.runPostToolBatch([{ ...call, tool_response: '1\ta' }])
    expect(seen('batch').tool_calls[0].tool_input.file_path).toBe(join(dir(), 'a.ts'))
  })
})

describe('updatedToolOutput in the tool’s own shape', () => {
  const answer = (output: unknown) => ({
    source: 'user' as const,
    command: `cat >/dev/null; echo '${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: output } })}'`,
    timeoutMs: 5000,
  })
  const replace = (output: unknown) =>
    runtime({ PostToolUse: [{ matcher: '*', handlers: [answer(output)] }] })

  it('a Read record replaces the text the model reads, as a Grep or WebFetch one does', async () => {
    const read = { type: 'text', file: { filePath: '/a', content: 'redacted' } }
    const result = { content: 'secret', details: { path: 'a', output: 'secret' } }
    expect(await replace(read).runPostToolUse('Read', { path: 'a' }, result)).toMatchObject({
      updatedToolOutput: 'redacted',
    })
    const grep = { mode: 'content', content: 'a.ts:1:x', numFiles: 1, filenames: ['a.ts'] }
    expect(
      await replace(grep).runPostToolUse('Search', { query: 'x' }, { content: 'secret' }),
    ).toMatchObject({ updatedToolOutput: 'a.ts:1:x' })
    const fetched = { url: 'https://a.dev', result: 'summary', code: 200 }
    expect(
      await replace(fetched).runPostToolUse(
        'Research',
        { question: 'q', urls: ['https://a.dev'] },
        {
          content: 'page',
        },
      ),
    ).toMatchObject({ updatedToolOutput: 'summary' })
  })
})
