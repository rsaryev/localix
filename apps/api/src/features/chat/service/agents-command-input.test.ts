import { expect, test } from 'bun:test'
import { parseAgentsCommand } from './agents-command-input'

test('quoted descriptions and instructions retain Markdown, newlines and literal shell text', () => {
  const parsed = parseAgentsCommand(
    '/agents create database-reviewer --description "Reviews migrations" --instructions \'Check:\n- $HOME\n- `schema`\'',
  )
  expect(parsed).toMatchObject({
    action: 'create',
    args: ['database-reviewer'],
    fields: { description: 'Reviews migrations', instructions: 'Check:\n- $HOME\n- `schema`' },
    confirm: false,
  })
})

test('bad quoting, duplicate fields and unknown options never become model prompts', () => {
  for (const prompt of [
    '/agents create x --instructions "open',
    '/agents edit @qa --permissions allow',
    '/agents edit @qa --description',
    '/agents edit @qa --description one --description two',
    '/agents delete @qa --confirm --confirm',
    '/agents edit @qa --priority 0.5',
    '/agents edit @qa --priority 3',
    '/agents edit @qa --priority nope',
    '/agents edit @qa --priority 0 --priority -1',
  ])
    expect(() => parseAgentsCommand(prompt)).toThrow()
})
