// A bundled plugin that carries the template's FRAME carries it byte for byte. The template's
// guidelines say so ("kept byte for byte") and every game's README repeats it, but nothing checked
// it: Chess, Checkers and Battleship kept a `backend/store.ts` from before the template moved to
// the SDK's `atomicWriteFile` — every write in the process sharing one `<file>.<pid>.tmp`, and a
// failed write leaving it behind for good — while 2048 and Tic-Tac-Toe had the fix. A copy that
// drifts is a fix that did not reach it.
import { describe, expect, test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import {
  listFiles,
  loadTemplateScaffold,
  shipsToCopies,
  templateFrame,
} from '../apps/api/src/features/plugins/authoring/template-layout'
import { findTemplatePlugin } from './stage-plugin-kit.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const template = findTemplatePlugin(repoRoot)

/** The names a module exports — how a file at a frame path is told apart from a plugin's own. */
const exportsOf = (text: string): Set<string> =>
  new Set(
    Array.from(
      text.matchAll(/^export (?:async )?(?:function|const|interface|type|class) (\w+)/gmu),
      (match) => match[1]!,
    ),
  )

/** The frame's code files, as the plugin authoring computes them, with what each exports. */
function frameFiles(templateDir: string) {
  const scaffold = loadTemplateScaffold(templateDir)
  return templateFrame(scaffold, listFiles(templateDir))
    .filter((file) => shipsToCopies(scaffold, file) && /\.tsx?$/u.test(file))
    .map((file) => {
      const text = readFileSync(join(templateDir, file), 'utf8')
      return { file, text, exports: exportsOf(text) }
    })
}

/**
 * `plugin/file` for every frame copy that differs from the template. A file at a frame path is a
 * COPY when it exports one of the frame file's names: Kanban's `backend/store.ts` opens a board
 * store of its own, and is not the frame's `openJsonStore`.
 */
function driftedCopies(pluginsDir: string, templateDir: string): string[] {
  const frame = frameFiles(templateDir)
  const drifted: string[] = []
  for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
    const dir = join(pluginsDir, plugin.name)
    if (!plugin.isDirectory() || resolve(dir) === resolve(templateDir)) continue
    for (const { file, text, exports } of frame) {
      const path = join(dir, file)
      if (!existsSync(path)) continue
      const copy = readFileSync(path, 'utf8')
      const isCopy = [...exportsOf(copy)].some((name) => exports.has(name))
      if (isCopy && copy !== text) drifted.push(`${plugin.name}/${file}`)
    }
  }
  return drifted.sort()
}

describe('the template frame in bundled plugins', () => {
  test('the frame has code files to compare', () => {
    expect(frameFiles(template).map(({ file }) => file)).toEqual(
      expect.arrayContaining(['backend/store.ts', 'ui/useNow.ts', 'ui/usePolledSnapshot.ts']),
    )
  })

  test('every copy of a frame file is the template’s, byte for byte', () => {
    expect(driftedCopies(join(repoRoot, 'plugins'), template)).toEqual([])
  })

  describe('controls', () => {
    const root = mkdtempSync(join(tmpdir(), 'frame-copies-'))
    const plugins = join(root, 'plugins')
    const templateCopy = join(plugins, basename(template))
    cpSync(template, templateCopy, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    })
    const useNow = readFileSync(join(template, 'ui', 'useNow.ts'), 'utf8')
    const write = (plugin: string, file: string, text: string) => {
      cpSync(templateCopy, join(plugins, plugin), { recursive: true })
      writeFileSync(join(plugins, plugin, file), text)
    }

    test('positive control: a copy that drifted is reported', () => {
      write('drifted', 'ui/useNow.ts', useNow.replace('setTimeout(tick, 0)', 'setTimeout(tick, 1)'))
      expect(driftedCopies(plugins, templateCopy)).toContain('drifted/ui/useNow.ts')
    })

    test('a plugin’s own module at a frame path is not a copy', () => {
      write('own-store', 'backend/store.ts', 'export function openBoardStore() {}\n')
      expect(driftedCopies(plugins, templateCopy)).not.toContain('own-store/backend/store.ts')
      rmSync(root, { recursive: true, force: true })
    })
  })
})
