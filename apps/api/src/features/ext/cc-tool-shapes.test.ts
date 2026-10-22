import { expect, test } from 'bun:test'
import {
  claudeCodeHookCall,
  localInputFromHook,
  toolCallEvent,
  toolInputOf,
} from './cc-tool-shapes'

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

test('a hook reads the call as Claude Code names it: hookify tests `tool_name == "Bash"`', () => {
  expect(claudeCodeHookCall({ name: 'bash' }, { command: 'rm -rf build' })).toEqual({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build' },
  })
  expect(
    claudeCodeHookCall({ name: 'write' }, { files: [{ path: 'a.ts', content: 'x' }] }),
  ).toEqual({
    tool_name: 'Write',
    tool_input: { files: [{ path: 'a.ts', content: 'x' }], file_path: 'a.ts', content: 'x' },
  })
  // A tool with no Claude Code counterpart keeps its own name and input.
  expect(claudeCodeHookCall({ name: 'kanban_add' }, { title: 't' })).toEqual({
    tool_name: 'kanban_add',
    tool_input: { title: 't' },
  })
})

test('a hook’s updatedInput in Claude Code’s shape folds back into Localix’s', () => {
  const seen = { edits: [{ path: 'a.ts', old_string: 'x', new_string: 'y' }] }
  // Claude Code's hook replaces the input with its own fields only.
  const updated = { file_path: 'b.ts', old_string: 'x', new_string: 'z' }
  expect(localInputFromHook('edit', seen, updated)).toEqual({
    edits: [{ path: 'b.ts', old_string: 'x', new_string: 'z' }],
  })
  expect(localInputFromHook('bash', { command: 'ls' }, { command: 'ls -la' })).toEqual({
    command: 'ls -la',
  })
})
