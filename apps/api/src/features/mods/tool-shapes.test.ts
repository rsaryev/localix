import { expect, test } from 'bun:test'
import { toolCallEvent, toolInputOf } from './tool-shapes'

test('a one-file edit reads as Claude Code’s Edit, and a rewrite lands on the edit', () => {
  const input = { edits: [{ path: 'a.ts', old_string: 'x', new_string: 'y' }], cwd: '/p' }
  const event = toolCallEvent({ name: 'edit' }, input, 'call-1')
  expect(event).toMatchObject({
    tool: 'Edit',
    tool_use_id: 'call-1',
    file_path: 'a.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(toolInputOf('edit', event)).toEqual(input)
  expect(toolInputOf('edit', { ...event, new_string: 'z' })).toEqual({
    edits: [{ path: 'a.ts', old_string: 'x', new_string: 'z' }],
    cwd: '/p',
  })
})

test('several edits, and Claude Code’s own shape, pass through untouched', () => {
  const several = { edits: [{ path: 'a', old_string: '1', new_string: '2' }, { path: 'b' }] }
  expect(toolInputOf('edit', toolCallEvent({ name: 'edit' }, several, 'c'))).toEqual(several)
  const own = { file_path: 'a', old_string: '1', new_string: '2' }
  expect(toolInputOf('edit', toolCallEvent({ name: 'edit' }, own, 'c'))).toEqual(own)
})

test('write, read, search and bash take Claude Code’s names and units', () => {
  expect(
    toolCallEvent({ name: 'write' }, { files: [{ path: 'n.md', content: 'hi' }] }, 'w'),
  ).toMatchObject({
    tool: 'Write',
    file_path: 'n.md',
    content: 'hi',
  })
  expect(toolCallEvent({ name: 'read' }, { path: '.env' }, 'r')).toMatchObject({
    tool: 'Read',
    file_path: '.env',
  })
  expect(
    toolInputOf('read', { tool: 'Read', tool_use_id: 'r', path: '.env', file_path: 'safe' }),
  ).toEqual({
    path: 'safe',
  })
  expect(toolCallEvent({ name: 'search' }, { query: 'TODO', glob: '*.ts' }, 's')).toMatchObject({
    tool: 'Grep',
    pattern: 'TODO',
  })
  const bash = toolCallEvent({ name: 'bash' }, { command: 'ls', timeout: 30 }, 'b')
  expect(bash).toMatchObject({ tool: 'Bash', command: 'ls', timeout: 30_000 })
  expect(toolInputOf('bash', bash)).toEqual({ command: 'ls', timeout: 30 })
  expect(toolCallEvent({ name: 'mcp_x_y', aliases: ['mcp__x__y'] }, { a: 1 }, 'm')).toEqual({
    a: 1,
    tool: 'mcp__x__y',
    tool_use_id: 'm',
  })
})
