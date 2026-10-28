// A bundled mini app that carries the template's FRAME carries it byte for byte. The template's
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
} from '../plugins/mini-app-authoring/src/scaffold/template-layout'
import { findTemplateMiniApp } from './stage-mini-app-kit.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const template = findTemplateMiniApp(repoRoot)

/** The names a module exports — how a file at a frame path is told apart from a mini app's own. */
const exportsOf = (text: string): Set<string> =>
  new Set(
    Array.from(
      text.matchAll(/^export (?:async )?(?:function|const|interface|type|class) (\w+)/gmu),
      (match) => match[1]!,
    ),
  )

/** The frame's code files, as the mini app authoring computes them, with what each exports. */
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
 * `app/file` for every frame copy that differs from the template. A file at a frame path is a
 * COPY when it exports one of the frame file's names: Kanban's `backend/store.ts` opens a board
 * store of its own, and is not the frame's `openJsonStore`.
 */
function driftedCopies(miniAppsDir: string, templateDir: string): string[] {
  const frame = frameFiles(templateDir)
  const drifted: string[] = []
  for (const miniApp of readdirSync(miniAppsDir, { withFileTypes: true })) {
    const dir = join(miniAppsDir, miniApp.name)
    if (!miniApp.isDirectory() || resolve(dir) === resolve(templateDir)) continue
    for (const { file, text, exports } of frame) {
      const path = join(dir, file)
      if (!existsSync(path)) continue
      const copy = readFileSync(path, 'utf8')
      const isCopy = [...exportsOf(copy)].some((name) => exports.has(name))
      if (isCopy && copy !== text) drifted.push(`${miniApp.name}/${file}`)
    }
  }
  return drifted.sort()
}

describe('the template frame in bundled mini apps', () => {
  test('the frame has code files to compare', () => {
    expect(frameFiles(template).map(({ file }) => file)).toEqual(
      expect.arrayContaining(['backend/store.ts', 'ui/useNow.ts', 'ui/usePolledSnapshot.ts']),
    )
  })

  test('every copy of a frame file is the template’s, byte for byte', () => {
    expect(driftedCopies(join(repoRoot, 'mini-apps'), template)).toEqual([])
  })

  describe('controls', () => {
    const root = mkdtempSync(join(tmpdir(), 'frame-copies-'))
    const miniApps = join(root, 'plugins')
    const templateCopy = join(miniApps, basename(template))
    cpSync(template, templateCopy, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    })
    const write = (miniApp: string, file: string, text: string) => {
      cpSync(templateCopy, join(miniApps, miniApp), { recursive: true })
      writeFileSync(join(miniApps, miniApp, file), text)
    }

    // The real frame files re-export the SDK, so the control gives the template copy a frame file
    // with a body of its own and plants a copy of it that drifted.
    test('positive control: a copy that drifted is reported', () => {
      const body = 'export function useNow() {\n  return setTimeout(() => {}, 0)\n}\n'
      writeFileSync(join(templateCopy, 'ui', 'useNow.ts'), body)
      write('drifted', 'ui/useNow.ts', body.replace('0)', '1)'))
      expect(driftedCopies(miniApps, templateCopy)).toContain('drifted/ui/useNow.ts')
    })

    test('a mini app’s own module at a frame path is not a copy', () => {
      write('own-store', 'backend/store.ts', 'export function openBoardStore() {}\n')
      expect(driftedCopies(miniApps, templateCopy)).not.toContain('own-store/backend/store.ts')
      rmSync(root, { recursive: true, force: true })
    })
  })
})
