import { describe, expect, test } from 'bun:test'
import { buildRebaseTodo, type TodoLine } from './rebase'

describe('buildRebaseTodo (pure)', () => {
  test('renders each action; reword becomes pick + exec amend -F', () => {
    const lines: TodoLine[] = [
      { hash: 'aaa', action: 'pick' },
      { hash: 'bbb', action: 'reword', msgFile: '/tmp/x/msg-0' },
      { hash: 'ccc', action: 'squash' },
      { hash: 'ddd', action: 'fixup' },
      { hash: 'eee', action: 'drop' },
    ]
    expect(buildRebaseTodo(lines)).toBe(
      [
        'pick aaa',
        'pick bbb',
        "exec git commit --amend -F '/tmp/x/msg-0'",
        'squash ccc',
        'fixup ddd',
        'drop eee',
        '',
      ].join('\n'),
    )
  })

  test('single-quotes a message-file path containing a quote (no shell injection)', () => {
    const out = buildRebaseTodo([{ hash: 'aaa', action: 'reword', msgFile: "/tmp/a'b/msg" }])
    expect(out).toContain("exec git commit --amend -F '/tmp/a'\\''b/msg'")
  })
})
