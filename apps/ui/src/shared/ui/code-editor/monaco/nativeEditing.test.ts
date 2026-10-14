import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import { runNativeEditCommand } from '@/shared/lib/nativeEditing'
import { registerDom } from '@localixai/kit/testing/dom'
import { registerMonacoNativeEditing } from './nativeEditing'

let teardown: () => Promise<void>
const disposables: Monaco.IDisposable[] = []
const hosts: HTMLElement[] = []

beforeAll(() => {
  teardown = registerDom()
})
afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose()
  for (const host of hosts.splice(0)) host.remove()
})
afterAll(() => teardown())

function mountEditor(readOnly = false) {
  const host = document.createElement('div')
  const textarea = document.createElement('textarea')
  host.append(textarea)
  document.body.append(host)
  hosts.push(host)
  const trigger = mock((_source: string, _command: string, _args: unknown) => {})
  const editor = {
    hasTextFocus: () => document.activeElement === textarea,
    trigger,
  } as unknown as Monaco.editor.IStandaloneCodeEditor
  const registration = registerMonacoNativeEditing(editor, () => readOnly)
  disposables.push(registration)
  return { host, textarea, trigger, registration }
}

describe('native edit commands reach the text owner', () => {
  test('Select All reaches Monaco even when its hidden textarea is empty', () => {
    const editor = mountEditor()
    editor.textarea.focus()
    expect(editor.textarea.value).toBe('')

    expect(runNativeEditCommand('select_all')).toBe(true)

    expect(editor.trigger).toHaveBeenCalledWith('native-menu', 'editor.action.selectAll', null)
  })

  test('Undo and Redo reach Monaco history instead of DOM history', () => {
    const editor = mountEditor()
    editor.textarea.focus()

    runNativeEditCommand('undo')
    runNativeEditCommand('redo')

    expect(editor.trigger.mock.calls).toEqual([
      ['native-menu', 'undo', null],
      ['native-menu', 'redo', null],
    ])
  })

  test('split editors route only to the one with text focus', () => {
    const first = mountEditor()
    const second = mountEditor()
    second.textarea.focus()

    runNativeEditCommand('select_all')

    expect(first.trigger).not.toHaveBeenCalled()
    expect(second.trigger).toHaveBeenCalledTimes(1)
    first.textarea.focus()
    runNativeEditCommand('undo')
    expect(first.trigger).toHaveBeenCalledWith('native-menu', 'undo', null)
    expect(second.trigger).toHaveBeenCalledTimes(1)
  })

  test('a nested find field selects its own query, leaving the file alone', () => {
    const editor = mountEditor()
    const input = document.createElement('input')
    input.value = 'needle'
    editor.host.append(input)
    input.focus()
    input.setSelectionRange(2, 2)

    runNativeEditCommand('select_all')

    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6])
    expect(editor.trigger).not.toHaveBeenCalled()
  })

  test('a composer textarea selects its own multiline text', () => {
    const editor = mountEditor()
    const textarea = document.createElement('textarea')
    textarea.value = 'one\ntwo'
    editor.host.append(textarea)
    textarea.focus()

    runNativeEditCommand('select_all')

    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 7])
    expect(editor.trigger).not.toHaveBeenCalled()
  })

  test('read-only editors allow selection and block history mutations', () => {
    const editor = mountEditor(true)
    editor.textarea.focus()

    runNativeEditCommand('undo')
    runNativeEditCommand('redo')
    runNativeEditCommand('select_all')

    expect(editor.trigger.mock.calls).toEqual([['native-menu', 'editor.action.selectAll', null]])
  })

  test('disposing an editor removes its handler', () => {
    const editor = mountEditor()
    editor.textarea.value = 'ordinary field'
    editor.textarea.focus()
    editor.registration.dispose()

    runNativeEditCommand('select_all')

    expect(editor.trigger).not.toHaveBeenCalled()
    expect([editor.textarea.selectionStart, editor.textarea.selectionEnd]).toEqual([0, 14])
  })

  test('unrelated menu ids are not edit commands', () => {
    const editor = mountEditor()
    editor.textarea.focus()

    expect(runNativeEditCommand('save_file')).toBe(false)
    expect(editor.trigger).not.toHaveBeenCalled()
  })
})
