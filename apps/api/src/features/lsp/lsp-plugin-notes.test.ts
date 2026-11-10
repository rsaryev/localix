import { describe, expect, test } from 'bun:test'

import {
  pluginLspNotes,
  summarizePluginLspServers,
  withoutBuiltinOverlap,
} from './lsp-plugin-notes'

describe('plugin LSP notes', () => {
  test('a missing binary gets an install hint; built-in extensions stay with the built-in', () => {
    const summaries = summarizePluginLspServers([
      {
        name: 'typescript',
        command: 'typescript-language-server-missing-for-test',
        extensions: ['.ts', '.zzz'],
      },
    ])
    expect(summaries[0]).toMatchObject({
      id: 'typescript',
      extensions: ['.zzz'],
      builtinExtensions: ['.ts'],
      missing: true,
    })
    const notes = pluginLspNotes(summaries)
    expect(notes[0]).toContain('built-in server already handles .ts')
    expect(notes[1]).toContain('not found on PATH')
  })

  test('withoutBuiltinOverlap leaves no extension of a server whose every one is built in', () => {
    expect(withoutBuiltinOverlap(['.ts'])).toBeNull()
    expect(withoutBuiltinOverlap(['.ts', '.zig'])).toEqual(['.zig'])
  })
})
