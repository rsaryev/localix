import { expect, test } from 'bun:test'
import { contentFromText } from './text'
import { spaceTypes } from '../types'
import { applyOps } from '../ops/apply'
import { emptySpace } from '../format/document'
import { describeSpace } from '../agent/describe'

test('short Markdown forms and file trees remain rendered text when pasted onto the board', () => {
  const sources = [
    '```tree\nproject/\n└── app.ts # entry\n```',
    '> [!STEPS]\n1. **First**\n   Start.',
    '> [!TABS]\n#### macOS\nUse brew.\n#### Linux\nUse apt.',
    '> [!STATS]\n- **3×** faster',
    '> [!PROS]\n- simple\n\n> [!CONS]\n- limited',
    '> [!TIP]\n> Keep a backup.',
    '- [ ] Prepare\n- [x] Verify',
    '## Files',
  ]
  for (const source of sources) {
    const content = contentFromText(source, spaceTypes)
    expect(content, source).toEqual({ type: 'text', props: { text: source } })
    const { space, results } = applyOps(
      emptySpace(),
      [{ op: 'create', id: 'fragment', ...content }],
      { registry: spaceTypes },
    )
    expect(results[0]!.ok).toBe(true)
    expect(space.elements.fragment!.props.text).toBe(source)
    expect(describeSpace(space, spaceTypes, { ids: ['fragment'] })).toContain(
      JSON.stringify(source),
    )
  }
  expect(contentFromText('A short idea', spaceTypes).type).toBe('note')
  expect(contentFromText('```ts\n// > [!TIP]\nconst n = 1\n```', spaceTypes).type).toBe('code')
  // A flowchart the board reads whole is drawn natively; one with anything it cannot draw stays
  // a full Mermaid element, so a paste never loses a line.
  expect(contentFromText('```mermaid\nflowchart LR\nA-->B\n```', spaceTypes).type).toBe('flow')
  expect(
    contentFromText('```mermaid\nflowchart LR\nA@{ shape: cloud } --> B\n```', spaceTypes).type,
  ).toBe('mermaid')
  expect(contentFromText('```mermaid\nclassDiagram\nA <|-- B\n```', spaceTypes).type).toBe(
    'mermaid',
  )
})
