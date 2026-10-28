import { describe, expect, test } from 'bun:test'

import {
  pluginLspNotes,
  summarizePluginLspServers,
  withoutBuiltinOverlap,
} from './lsp-plugin-notes'

describe('plugin LSP notes', () => {
  test('a missing binary gets an install hint; built-in extensions stay with the built-in', () => {
    const summaries = summarizePluginLspServers({
      typescript: {
        command: 'typescript-language-server-missing-for-test',
        extensionToLanguage: { '.ts': 'typescript', '.zzz': 'zzz' },
      },
    })
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

  test('withoutBuiltinOverlap drops a server whose every extension is built in', () => {
    expect(withoutBuiltinOverlap({ command: 'x', extensionToLanguage: { '.ts': 't' } })).toBeNull()
    expect(
      withoutBuiltinOverlap({ command: 'x', extensionToLanguage: { '.ts': 't', '.zig': 'zig' } }),
    ).toEqual({ command: 'x', extensionToLanguage: { '.zig': 'zig' } })
  })
})
