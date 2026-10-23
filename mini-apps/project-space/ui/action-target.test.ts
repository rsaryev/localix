import { expect, test } from 'bun:test'
import type { ActionContext, ActionTarget } from '@localixai/mini-app-sdk/ui'
import { canAddToSpace, contentOperation } from './action-target'
import { spaceTypes } from '../shared/types'
import { applyOps } from '../shared/ops/apply'
import { emptySpace } from '../shared/format/document'
import { describeSpace } from '../shared/agent/describe'

const context = (target: ActionTarget, surface = 'chat.content'): ActionContext => ({
  sessionId: 's',
  surface,
  target,
})
test('native targets preserve content, file lines and safe image links', () => {
  const targets: Exclude<ActionTarget, { kind: 'image' }>[] = [
    { kind: 'code', text: 'const x = "value"', language: 'ts' },
    { kind: 'markdown', block: 'quote', markdown: '> **Keep** this\n> — Author' },
    { kind: 'table', markdown: '| A | B |\n| --- | --- |\n| 1 | 2 |' },
    { kind: 'link', url: 'https://example.com/picture.PNG?size=2#image' },
    { kind: 'link', url: 'https://example.com/article' },
    { kind: 'file', path: 'src/main.ts', line: 42 },
    { kind: 'file', path: 'assets/photo.png' },
  ]
  const operations = targets.map(contentOperation)
  const { space, results } = applyOps(emptySpace(), operations, { registry: spaceTypes })
  expect(results.every((result) => result.ok)).toBe(true)
  const elements = Object.values(space.elements)
  expect(elements.map((element) => element.type)).toEqual([
    'code',
    'text',
    'table',
    'image',
    'link',
    'file',
    'image',
  ])
  expect(elements[0]!.props.code).toBe('const x = "value"')
  expect(elements[1]!.props.text).toBe('> **Keep** this\n> — Author')
  expect(elements[2]!.props.rows).toEqual([['1', '2']])
  expect(elements[3]!.props.url).toBe(targets[3]!.kind === 'link' ? targets[3]!.url : '')
  expect(elements[5]!.props.line).toBe(42)
})
test('Mermaid remains editable and its full source is available to the agent', () => {
  const source =
    'sequenceDiagram\nparticipant A\nparticipant B\nalt Accepted\nA->>B: Start\nelse Refused\nB-->>A: Retry\nend'
  const { space } = applyOps(
    emptySpace(),
    [contentOperation({ kind: 'visualization', format: 'mermaid', source })],
    { registry: spaceTypes },
  )
  const id = Object.keys(space.elements)[0]!
  expect(space.elements[id]!.type).toBe('mermaid')
  expect(describeSpace(space, spaceTypes, { ids: [id] })).toContain(source)
  const changed = applyOps(
    space,
    [{ op: 'update', id, props: { source: 'flowchart LR\nA-->B' } }],
    { registry: spaceTypes },
  )
  expect(changed.results[0]!.ok).toBe(true)
  expect(changed.space.elements[id]!.props.source).toBe('flowchart LR\nA-->B')
})
test('eligibility rejects other surfaces, unknown diagrams, empty or oversized content and unsafe URLs', () => {
  expect(canAddToSpace(context({ kind: 'code', text: 'hello' }, 'board.element'))).toBe(false)
  expect(canAddToSpace(context({ kind: 'visualization', format: 'unknown', source: 'A' }))).toBe(
    false,
  )
  for (const text of ['', '  ', 'x'.repeat(65537)])
    expect(canAddToSpace(context({ kind: 'code', text }))).toBe(false)
  for (const url of [
    'javascript:alert(1)',
    'file:///tmp/a',
    'data:text/html,test',
    'blob:https://example.com/id',
  ]) {
    expect(canAddToSpace(context({ kind: 'image', src: url }))).toBe(false)
    expect(canAddToSpace(context({ kind: 'link', url }))).toBe(false)
  }
  expect(canAddToSpace(context({ kind: 'image', src: 'data:image/png;base64,AAAA' }))).toBe(true)
  expect(spaceTypes.read('image', { path: 'a.png', url: 'https://example.com/a.png' }).status).toBe(
    'invalid',
  )
  expect(spaceTypes.read('image', { url: 'https://example.com/a.png' }).status).toBe('ok')
})
