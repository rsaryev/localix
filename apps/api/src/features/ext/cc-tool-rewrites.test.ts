/**
 * A call in Claude Code's shape reaching a Localix tool: a PreToolUse hook's `updatedInput`
 * (`localInputFromHook`) and a mod's `$.tool.call` / `next(e)` event (`toolInputOf`). Each lands
 * on the fields the Localix tool runs, never on a field it would refuse or misread.
 */
import { expect, test } from 'bun:test'

import {
  claudeCodeToolName,
  localInputFromHook,
  localToolName,
  toolCallEvent,
  toolInputOf,
} from './cc-tool-shapes'

test('a rewritten Bash line replaces the batch; the one shown runs the batch', () => {
  const seen = { commands: ['npm test', 'npm run lint'] }
  expect(localInputFromHook('bash', seen, { command: 'npm test && npm run lint' })).toEqual(seen)
  expect(localInputFromHook('bash', seen, { command: 'npm test -- --bail' })).toEqual({
    command: 'npm test -- --bail',
  })
  expect(
    localInputFromHook(
      'bash',
      { command: 'sleep 9' },
      { command: 'sleep 9', run_in_background: true },
    ),
  ).toEqual({ command: 'sleep 9', background: true })
})

test('Read’s line offset and limit become a line range; a byte offset survives a rewrite', () => {
  expect(toolInputOf('read', { tool: 'Read', file_path: 'a.ts', offset: 5, limit: 3 })).toEqual({
    path: 'a.ts',
    start_line: 5,
    end_line: 7,
  })
  expect(
    localInputFromHook('read', { path: 'a.ts', byte_offset: 4096 }, { file_path: 'b.ts' }),
  ).toEqual({ path: 'b.ts', byte_offset: 4096 })
})

test('Glob and Grep fold back into search’s glob and query', () => {
  expect(toolInputOf('search', { tool: 'Glob', pattern: '**/*.md' })).toEqual({ glob: '**/*.md' })
  expect(toolInputOf('search', { tool: 'Grep', pattern: 'todo', '-i': true, '-C': 2 })).toEqual({
    query: 'todo',
    ignore_case: true,
    context: 2,
  })
  // The search tool takes Grep's output mode, limit, type and multiline as they are.
  expect(
    toolInputOf('search', {
      tool: 'Grep',
      pattern: 'todo',
      output_mode: 'count',
      head_limit: 5,
      type: 'ts',
      multiline: true,
    }),
  ).toEqual({
    query: 'todo',
    output_mode: 'count',
    head_limit: 5,
    type: 'ts',
    multiline: true,
  })
  // A hook sees the mode the search runs in, and `-i` for ignore_case.
  expect(
    toolCallEvent(
      { name: 'search' },
      { query: 'a', output_mode: 'files_with_matches', ignore_case: true },
      'g',
    ),
  ).toMatchObject({ tool: 'Grep', output_mode: 'files_with_matches', '-i': true })
  expect(toolCallEvent({ name: 'search' }, { query: 'a' }, 'g')).toMatchObject({
    output_mode: 'content',
  })
  expect(localToolName('Glob')).toBe('search')
  expect(claudeCodeToolName({ name: 'search' }, { glob: '*.ts' })).toBe('Glob')
})

test('WebFetch and WebSearch fold back into research', () => {
  expect(
    toolInputOf('research', { tool: 'WebFetch', url: 'https://a.dev', prompt: 'Why?' }),
  ).toEqual({ question: 'Why?', urls: ['https://a.dev'] })
  expect(
    toolInputOf('research', { tool: 'WebSearch', query: 'bun', blocked_domains: ['x.com'] }),
  ).toEqual({ question: 'bun', exclude_domains: ['x.com'] })
})

test('Agent, SendMessage and TaskStop fold back into delegate’s strict input', () => {
  const agent = {
    tool: 'Agent',
    prompt: 'Map the API',
    description: 'API',
    subagent_type: 'Explore',
  }
  expect(toolInputOf('delegate', { ...agent, model: 'opus' })).toEqual({
    task: 'Map the API',
    title: 'API',
    agent: 'Explore',
  })
  expect(toolInputOf('delegate', { tool: 'SendMessage', to: 'c1', message: 'stop' })).toEqual({
    action: 'message',
    run: 'c1',
    message: 'stop',
  })
  expect(toolInputOf('delegate', { tool: 'TaskStop', task_id: 'c1' })).toEqual({
    action: 'stop',
    run: 'c1',
  })
  expect(localToolName('Agent')).toBe('delegate')
  expect(localToolName('TaskStop')).toBe('jobs')
})

test('Skill, AskUserQuestion, ExitPlanMode and ToolSearch fold back into Localix’s tools', () => {
  expect(toolInputOf('skill', { tool: 'Skill', skill: 'deploy', args: 'prod' })).toEqual({
    action: 'get',
    name: 'deploy',
    arguments: 'prod',
  })
  const question = {
    question: 'Which?',
    header: 'Lib',
    options: [{ label: 'A' }],
    multiSelect: true,
  }
  expect(toolInputOf('ask', { tool: 'AskUserQuestion', questions: [question] })).toEqual({
    questions: [{ question: 'Which?', id: 'Lib', options: [{ label: 'A' }], multi: true }],
  })
  expect(toolInputOf('plan', { tool: 'ExitPlanMode', plan: '# P' })).toEqual({ action: 'present' })
  expect(toolInputOf('activate_tools', { tool: 'ToolSearch', query: 'select:a,b' })).toEqual({
    names: ['a', 'b'],
  })
})
