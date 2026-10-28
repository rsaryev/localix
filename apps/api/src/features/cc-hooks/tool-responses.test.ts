/**
 * What a PostToolUse hook reads as `tool_response`, in each Claude Code tool's output shape
 * (claude-code-tools/index.d.ts, BuiltinToolResults): Write's `{type, filePath, content,
 * structuredPatch}`, Edit's `{filePath, oldString, newString, …}`, Read's `{type, file}`, Bash's
 * `{stdout, stderr, interrupted}`; and `updatedToolOutput` given back in that shape.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'

const dir = tempDirPerTest('cc-tool-responses-')
const silent = { warn: () => {}, info: () => {} }
const saved = () => JSON.parse(readFileSync(join(dir(), 'post.json'), 'utf8'))

const make = (command = `cat > "${join(dir(), 'post.json')}"`) =>
  createCcHooksRuntime({
    registry: { PostToolUse: [{ handlers: [{ source: 'plugin', command, timeoutMs: 5000 }] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

const DIFF = '--- a/p/a.ts\n+++ b/p/a.ts\n@@ -1,2 +1,2 @@\n line\n-old\n+new\n'

describe('tool_response', () => {
  it('Write: type, filePath, content and structuredPatch', async () => {
    const details = { cwd: '/p', files: [{ path: '/p/a.md', created: true, byteLength: 1 }] }
    await make().runPostToolUse(
      'Write',
      { files: [{ path: '/p/a.md', content: 'A' }] },
      {
        content: 'saved',
        details,
      },
    )
    expect(saved().tool_response).toMatchObject({
      type: 'create',
      filePath: '/p/a.md',
      content: 'A',
      structuredPatch: [],
      originalFile: null,
    })
  })

  it('Edit: filePath, oldString, newString, replaceAll and the hunks', async () => {
    const details = { cwd: '/p', files: [{ path: '/p/a.ts', diff: DIFF, replacements: 1 }] }
    const input = { edits: [{ path: '/p/a.ts', old_string: 'old', new_string: 'new' }] }
    await make().runPostToolUse('Edit', input, { content: 'edited', details })
    expect(saved().tool_response).toMatchObject({
      filePath: '/p/a.ts',
      oldString: 'old',
      newString: 'new',
      replaceAll: false,
      userModified: false,
      structuredPatch: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' line', '-old', '+new'] },
      ],
    })
  })

  it('Read: a text file as {type, file: {filePath, content, numLines}}', async () => {
    const details = { path: '/p/a.md', bytes: 8, truncated: false, output: 'one\ntwo' }
    await make().runPostToolUse('Read', { path: '/p/a.md' }, { content: 'one\ntwo', details })
    expect(saved().tool_response).toMatchObject({
      type: 'text',
      file: { filePath: '/p/a.md', content: 'one\ntwo', numLines: 2, startLine: 1 },
    })
  })

  it('Bash: stdout and stderr apart, and a command stopped by a signal is interrupted', async () => {
    const details = { output: 'out\nerr', stdout: 'out', stderr: 'err', exitCode: 143 }
    await make().runPostToolUse('Bash', { command: 'x' }, { content: 'out\nerr', details })
    expect(saved().tool_response).toMatchObject({
      stdout: 'out',
      stderr: 'err',
      interrupted: true,
    })
  })
})

describe('updatedToolOutput in the tool’s own shape', () => {
  const answer = (value: unknown) =>
    `cat >/dev/null; echo '${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: value } })}'`

  it('Read: the replacement file content is what the model sees', async () => {
    const replaced = { type: 'text', file: { filePath: '/p/.env', content: '[redacted]' } }
    const result = await make(answer(replaced)).runPostToolUse(
      'Read',
      { path: '/p/.env' },
      { content: 'TOKEN=1', details: { path: '/p/.env', output: 'TOKEN=1' } },
    )
    expect(result.updatedToolOutput).toBe('[redacted]')
  })

  it('WebFetch: the replacement result is what the model sees', async () => {
    const result = await make(
      answer({ result: 'summary only', url: 'https://x.dev' }),
    ).runPostToolUse(
      'Research',
      { question: 'q', urls: ['https://x.dev'] },
      { content: 'full page' },
    )
    expect(result.updatedToolOutput).toBe('summary only')
  })
})
