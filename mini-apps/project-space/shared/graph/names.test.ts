import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import { spaceTypes } from '../types'
import { elementName, elementText } from './names'

test('a person reads an element’s name; the agent and search read what it says', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      { op: 'create', id: 'note', type: 'note', x: 0, y: 0, text: '**Ship** it\n- [ ] ==docs==' },
      {
        op: 'create',
        id: 'chart',
        type: 'flow',
        x: 0,
        y: 300,
        text: 'flowchart LR\n  a[Plan<br/>scope] --> b(Build)',
        props: { title: 'Release' },
      },
    ],
    { registry: spaceTypes },
  )
  expect(elementName(space, spaceTypes, 'note')).toBe('Ship it docs')
  expect(elementName(space, spaceTypes, 'chart')).toBe('Release: Plan, Build')
  // The marks and the Mermaid stay in the text the agent reads and search matches.
  expect(elementText(space, spaceTypes, 'note')).toContain('**Ship**')
  expect(elementText(space, spaceTypes, 'chart')).toStartWith('flowchart LR')
})
