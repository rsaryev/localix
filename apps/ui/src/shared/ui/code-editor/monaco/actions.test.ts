import { describe, expect, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import type { EditorReference } from '../types'
import { addEditorActions, type CodeEditorActionProps } from './actions'
import type { createEditorWidgets } from './editorWidgets'
import type { MonacoApi } from './runtime'

const reference = (file: string, line: number, character: number): EditorReference => ({
  file,
  fileLabel: file,
  line,
  character,
  preview: '',
})

function harness(props: CodeEditorActionProps) {
  const actions = new Map<string, Monaco.editor.IActionDescriptor>()
  const calls: unknown[][] = []
  const opened: {
    label: string
    references: EditorReference[]
    pick: (r: EditorReference) => void
  }[] = []
  class Position {
    readonly lineNumber: number
    readonly column: number
    constructor(lineNumber: number, column: number) {
      this.lineNumber = lineNumber
      this.column = column
    }
  }
  const monaco = {
    Position,
    KeyMod: { CtrlCmd: 0, Shift: 0 },
    KeyCode: { KeyS: 0, Enter: 0, F12: 0 },
    editor: { ScrollType: { Smooth: 0 }, MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 } },
  } as unknown as MonacoApi
  const editor = {
    getId: () => 'e1',
    createContextKey: () => ({ set: () => {} }),
    addAction: (descriptor: Monaco.editor.IActionDescriptor) => {
      actions.set(descriptor.label, descriptor)
      return { dispose: () => {} }
    },
    onMouseDown: () => ({ dispose: () => {} }),
    getPosition: () => new Position(3, 5),
    setPosition: (position: unknown) => calls.push(['setPosition', position]),
    revealPositionInCenter: () => {},
    focus: () => {},
  } as unknown as Monaco.editor.IStandaloneCodeEditor
  const model = {
    getLineCount: () => 100,
    getLineMaxColumn: () => 80,
  } as unknown as Monaco.editor.ITextModel
  const widgets = {
    openReferences: (
      label: string,
      references: EditorReference[],
      pick: (r: EditorReference) => void,
    ) => opened.push({ label, references, pick }),
  } as unknown as ReturnType<typeof createEditorWidgets>
  addEditorActions({ monaco, editor, model, widgets }, () => ({
    filePath: 'a.ts',
    onLocationNavigate: (location) => calls.push(['navigate', location]),
    ...props,
  }))
  const run = (label: string) => actions.get(label)!.run(editor) as Promise<void>
  return { run, calls, opened }
}

describe.each([
  ['Go to Implementation', 'implementationSource', 'Implementations'],
  ['Go to Type Definition', 'typeDefinitionSource', 'Type Definitions'],
] as const)('%s', (label, sourceKey, title) => {
  test('asks the source at the cursor and jumps straight to a single target', async () => {
    const asked: unknown[] = []
    const { run, calls, opened } = harness({
      [sourceKey]: async (position: unknown) => {
        asked.push(position)
        return [reference('b.ts', 9, 2)]
      },
    })
    await run(label)
    expect(asked).toEqual([{ line: 2, character: 4 }])
    expect(opened).toEqual([])
    expect(calls).toEqual([['navigate', { file: 'b.ts', line: 9, column: 2 }]])
  })

  test('a target in the same file moves the cursor instead of navigating', async () => {
    const { run, calls } = harness({ [sourceKey]: async () => [reference('a.ts', 4, 1)] })
    await run(label)
    expect(calls).toEqual([['setPosition', { lineNumber: 5, column: 2 }]])
  })

  test('several targets open the references list under its title', async () => {
    const targets = [reference('b.ts', 1, 0), reference('c.ts', 2, 3)]
    const { run, calls, opened } = harness({ [sourceKey]: async () => targets })
    await run(label)
    expect(opened.map((entry) => [entry.label, entry.references])).toEqual([[title, targets]])
    expect(calls).toEqual([])
    opened[0]!.pick(targets[1]!)
    expect(calls).toEqual([['navigate', { file: 'c.ts', line: 2, column: 3 }]])
  })

  test('no targets does nothing', async () => {
    const { run, calls, opened } = harness({ [sourceKey]: async () => [] })
    await run(label)
    expect(calls).toEqual([])
    expect(opened).toEqual([])
  })
})
