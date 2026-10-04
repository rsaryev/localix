import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'

import { classifyBashCall } from './bash-call-class'
import { createBashTool } from './bash'

const READ: CallClass = { effect: 'read' }
const SESSION: CallClass = { effect: 'session' }
const EXTERNAL: CallClass = { effect: 'external' }
const IRREVERSIBLE: CallClass = { effect: 'external', irreversible: true }

describe('bash classify: commands', () => {
  test.each([
    ['a read-only command', { command: 'git status' }, READ],
    ['a read-only pipeline', { command: 'ls -la | head -5' }, READ],
    ['a writing command', { command: 'npm install' }, EXTERNAL],
    ['a redirect into a file', { command: 'echo hi > out.txt' }, EXTERNAL],
    ['a dangerous command', { command: 'rm -rf build' }, IRREVERSIBLE],
    ['a force push', { command: 'git push --force origin main' }, IRREVERSIBLE],
    ['an all-read-only batch', { commands: ['ls', 'git log -1'] }, READ],
    ['a batch with one writer', { commands: ['ls', 'touch x'] }, EXTERNAL],
    ['a batch with one dangerous entry', { commands: ['ls', 'rm -rf /tmp/x'] }, IRREVERSIBLE],
    ['a batch given as one string', { commands: 'ls' }, READ],
    ['a batch given as a JSON string', { commands: '["ls","touch x"]' }, EXTERNAL],
  ])('%s', (_label, input, expected) => {
    expect(classifyBashCall(input)).toEqual(expected)
  })

  test('the batch wins over `command`, as execute dispatches it', () => {
    expect(classifyBashCall({ command: 'ls', commands: ['touch x'] })).toEqual(EXTERNAL)
    expect(classifyBashCall({ command: 'touch x', commands: ['ls'] })).toEqual(READ)
    // An empty batch is ignored by execute, so `command` decides.
    expect(classifyBashCall({ command: 'touch x', commands: [] })).toEqual(EXTERNAL)
  })
})

describe('bash classify: background work is never a read', () => {
  test.each([
    ['a read-only background job', { command: 'tail -f log.txt', background: true }, SESSION],
    ['a read-only notify job', { command: 'ls', background: true, notify: true }, SESSION],
    ['a read-only until monitor', { command: 'test -f done.txt', until: 5 }, SESSION],
    ['a writing background job', { command: 'npm run dev', background: true }, EXTERNAL],
    ['a writing until monitor', { command: 'touch x', until: 5 }, EXTERNAL],
    ['a dangerous background job', { command: 'docker rm -f x', background: true }, IRREVERSIBLE],
    // execute runs a batch in the foreground whatever `background` says.
    ['a batch flagged background', { commands: ['ls'], background: true }, READ],
  ])('%s', (_label, input, expected) => {
    expect(classifyBashCall(input)).toEqual(expected)
  })
})

describe('bash classify: interactive PTY actions', () => {
  test.each([
    ['screen', { action: 'screen', terminal_id: 't1' }, READ],
    ['list', { action: 'list' }, READ],
    ['wait', { action: 'wait', terminal_id: 't1', wait_for: '$' }, READ],
    ['close', { action: 'close', terminal_id: 't1' }, IRREVERSIBLE],
    // The foreground program is unknown: read-only-looking input is still not a read.
    ['open a read-only command', { action: 'open', command: 'htop' }, EXTERNAL],
    ['open a dangerous command', { action: 'open', command: 'sudo vim /etc/hosts' }, IRREVERSIBLE],
    ['type read-only text', { action: 'type', terminal_id: 't1', text: 'ls' }, EXTERNAL],
    ['type dangerous text', { action: 'type', terminal_id: 't1', text: 'rm -rf .' }, IRREVERSIBLE],
    ['keys', { action: 'keys', terminal_id: 't1', keys: ['Enter'] }, EXTERNAL],
    ['an action with a command ignored', { action: 'screen', command: 'touch x' }, READ],
  ])('%s', (_label, input, expected) => {
    expect(classifyBashCall(input)).toEqual(expected)
  })
})

describe('bash classify: what it cannot place is external, never read', () => {
  test.each([
    ['no input', undefined],
    ['a non-object', 'ls'],
    ['no command at all', { description: 'nothing' }],
    ['a blank command', { command: '   ' }],
    ['an unknown action', { action: 'explode', command: 'ls' }],
    ['a non-string batch entry', { commands: ['ls', 3] }],
    ['a non-array batch', { commands: 5, command: 'ls' }],
  ])('%s', (_label, input) => {
    expect(classifyBashCall(input)).toEqual(EXTERNAL)
  })
})

test('the bash tool declares this classifier and stays statically a writer', () => {
  const tool = createBashTool()
  expect(tool.mutates).toBe(true)
  expect(tool.classify?.({ command: 'ls' })).toEqual(READ)
  expect(tool.classify?.({ command: 'npm install' })).toEqual(EXTERNAL)
})
