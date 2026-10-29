import { expect, test } from 'bun:test'
import {
  claudeCodeHookCall,
  claudeCodeToolName,
  localInputFromHook,
  localToolName,
  singleCalls,
  toolCallEvent,
  toolInputOf,
} from './cc-tool-shapes'

test('a one-file edit reads as Claude Code’s Edit, and a rewrite lands on the edit', () => {
  const input = { edits: [{ path: 'a.ts', old_string: 'x', new_string: 'y' }], cwd: '/p' }
  const event = toolCallEvent({ name: 'Edit' }, input, 'call-1')
  expect(event).toMatchObject({
    tool: 'Edit',
    tool_use_id: 'call-1',
    file_path: 'a.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(toolInputOf('Edit', event)).toEqual(input)
  expect(toolInputOf('Edit', { ...event, new_string: 'z' })).toEqual({
    edits: [{ path: 'a.ts', old_string: 'x', new_string: 'z' }],
    cwd: '/p',
  })
})

test('several edits pass through untouched; Claude Code’s own shape comes back as the one edit', () => {
  const several = { edits: [{ path: 'a', old_string: '1', new_string: '2' }, { path: 'b' }] }
  expect(toolInputOf('Edit', toolCallEvent({ name: 'Edit' }, several, 'c'))).toEqual(several)
  const own = { file_path: 'a', old_string: '1', new_string: '2' }
  expect(toolInputOf('Edit', toolCallEvent({ name: 'Edit' }, own, 'c'))).toEqual({
    edits: [{ path: 'a', old_string: '1', new_string: '2' }],
  })
})

test('one edit or one file reads as Claude Code’s single-file call, its path absolute', () => {
  expect(
    toolCallEvent({ name: 'Write' }, { files: [{ path: 'n.md', content: 'hi' }] }, 'w', '/p'),
  ).toEqual({ tool: 'Write', tool_use_id: 'w', file_path: '/p/n.md', content: 'hi' })
  expect(
    toolCallEvent(
      { name: 'Edit' },
      { edits: [{ path: 'a', old_string: '1', new_string: '2' }] },
      'e',
      '/p',
    ),
  ).toEqual({ tool: 'Edit', tool_use_id: 'e', file_path: '/p/a', old_string: '1', new_string: '2' })
  expect(singleCalls('Write', { files: [{ path: 'a' }, { path: 'b' }] })).toEqual([
    { files: [{ path: 'a' }] },
    { files: [{ path: 'b' }] },
  ])
})

test('write, read, search and bash take Claude Code’s names and units', () => {
  expect(
    toolCallEvent({ name: 'Write' }, { files: [{ path: 'n.md', content: 'hi' }] }, 'w'),
  ).toMatchObject({
    tool: 'Write',
    file_path: 'n.md',
    content: 'hi',
  })
  expect(toolCallEvent({ name: 'Read' }, { path: '.env' }, 'r')).toMatchObject({
    tool: 'Read',
    file_path: '.env',
  })
  expect(
    toolInputOf('Read', { tool: 'Read', tool_use_id: 'r', path: '.env', file_path: 'safe' }),
  ).toEqual({
    path: 'safe',
  })
  expect(toolCallEvent({ name: 'Search' }, { query: 'TODO', glob: '*.ts' }, 's')).toMatchObject({
    tool: 'Grep',
    pattern: 'TODO',
  })
  const bash = toolCallEvent({ name: 'Bash' }, { command: 'ls', timeout: 30 }, 'b')
  expect(bash).toMatchObject({ tool: 'Bash', command: 'ls', timeout: 30_000 })
  expect(toolInputOf('Bash', bash)).toEqual({ command: 'ls', timeout: 30 })
  expect(toolCallEvent({ name: 'mcp_x_y', aliases: ['mcp__x__y'] }, { a: 1 }, 'm')).toEqual({
    a: 1,
    tool: 'mcp__x__y',
    tool_use_id: 'm',
  })
})

test('a hook reads the call as Claude Code names it: hookify tests `tool_name == "Bash"`', () => {
  expect(claudeCodeHookCall({ name: 'Bash' }, { command: 'rm -rf build' })).toEqual({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build' },
  })
  expect(
    claudeCodeHookCall({ name: 'Write' }, { files: [{ path: 'a.ts', content: 'x' }] }),
  ).toEqual({
    tool_name: 'Write',
    tool_input: { file_path: 'a.ts', content: 'x' },
  })
  // A tool with no Claude Code counterpart keeps its own name and input.
  expect(claudeCodeHookCall({ name: 'board_add' }, { title: 't' })).toEqual({
    tool_name: 'board_add',
    tool_input: { title: 't' },
  })
})

test('a hook’s updatedInput in Claude Code’s shape folds back into Localix’s', () => {
  const seen = { edits: [{ path: 'a.ts', old_string: 'x', new_string: 'y' }] }
  // Claude Code's hook replaces the input with its own fields only.
  const updated = { file_path: 'b.ts', old_string: 'x', new_string: 'z' }
  expect(localInputFromHook('Edit', seen, updated)).toEqual({
    edits: [{ path: 'b.ts', old_string: 'x', new_string: 'z' }],
  })
  expect(localInputFromHook('Bash', { command: 'ls' }, { command: 'ls -la' })).toEqual({
    command: 'ls -la',
  })
})

test('a hook reads a file path absolute against its cwd, and an unchanged one folds back as written', () => {
  const write = { files: [{ path: 'notes/a.md', content: 'x' }] }
  expect(claudeCodeHookCall({ name: 'Write' }, write, '/work').tool_input).toMatchObject({
    file_path: '/work/notes/a.md',
  })
  expect(
    claudeCodeHookCall({ name: 'Read' }, { path: '/abs/b.ts' }, '/work').tool_input,
  ).toMatchObject({ file_path: '/abs/b.ts' })
  const same = { file_path: '/work/notes/a.md', content: 'y' }
  expect(localInputFromHook('Write', write, same, '/work')).toEqual({
    files: [{ path: 'notes/a.md', content: 'y' }],
  })
  const moved = { file_path: '/work/other.md', content: 'x' }
  expect(localInputFromHook('Write', write, moved, '/work')).toEqual({
    files: [{ path: '/work/other.md', content: 'x' }],
  })
})

test('only a skill `get` is Claude Code’s Skill; save, list and delete are Localix’s own calls', () => {
  const get = toolCallEvent({ name: 'Skill' }, { action: 'get', name: 'review' }, 's')
  expect(get).toMatchObject({ tool: 'Skill', skill: 'review' })
  for (const action of ['save', 'list', 'delete'])
    expect(toolCallEvent({ name: 'Skill' }, { action, name: 'review' }, 's').tool).toBe('Skill')
  expect(claudeCodeHookCall({ name: 'Skill' }, { action: 'list' }).tool_name).toBe('Skill')
})

test('a bash `until` wait reads as Claude Code’s Monitor, and a rewrite lands on the wait', () => {
  const input = { command: 'curl -sf localhost:3000', until: 10, timeout: 120 }
  const event = toolCallEvent({ name: 'Bash' }, input, 'm')
  expect(event).toMatchObject({
    tool: 'Monitor',
    command: 'curl -sf localhost:3000',
    timeout_ms: 120_000,
  })
  expect(toolInputOf('Bash', event)).toEqual(input)
  expect(toolInputOf('Bash', { ...event, timeout_ms: 30_000 })).toEqual({ ...input, timeout: 30 })
  // A plain command, and a background job, stay Bash.
  expect(toolCallEvent({ name: 'Bash' }, { command: 'ls', background: true }, 'b').tool).toBe(
    'Bash',
  )
})

test('an edit of a notebook carries NotebookEdit’s fields beside Edit’s', () => {
  const input = { edits: [{ path: 'nb/a.ipynb', old_string: 'x = 1', new_string: 'x = 2' }] }
  const view = claudeCodeHookCall({ name: 'Edit' }, input, '/p').tool_input as Record<
    string,
    unknown
  >
  expect(view).toMatchObject({
    file_path: '/p/nb/a.ipynb',
    notebook_path: '/p/nb/a.ipynb',
    new_source: 'x = 2',
    edit_mode: 'replace',
  })
  const plain = claudeCodeHookCall(
    { name: 'Edit' },
    { edits: [{ path: 'a.ts', old_string: 'a', new_string: 'b' }] },
    '/p',
  ).tool_input as Record<string, unknown>
  expect(plain.notebook_path).toBeUndefined()
  // The extra fields never reach the edit tool.
  expect(localInputFromHook('Edit', input, view, '/p')).toEqual(input)
})

test('a tool Claude Code has no name for reaches hooks and mods by the name the model calls it', () => {
  expect(claudeCodeToolName({ name: 'Browser' }, { action: 'open' })).toBe('Browser')
  expect(claudeCodeToolName({ name: 'Store' }, { action: 'search' })).toBe('Store')
  expect(localToolName('Browser')).toBe('Browser')
  expect(localToolName('GlobalSearch')).toBe('GlobalSearch')
})
