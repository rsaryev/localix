import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { PluginKit } from './kit'
import type { PluginKitManifest } from './kit-layout'
import { agentInstruction, agentsMd, HOST_JUDGMENT_CONTRACT, LIVE_DATA_CONTRACT } from './prose'
import { loadTemplateScaffold } from './template-layout'

const repoRoot = resolve(import.meta.dir, '../../../../../..')
const templateDir = join(repoRoot, 'mini-apps', 'template')
const kit: PluginKit = {
  dir: repoRoot,
  templateDir,
  manifest: { kitModules: [] } as unknown as PluginKitManifest,
}
const scaffold = loadTemplateScaffold(templateDir)
const input = { name: 'gpu-monitor', displayName: 'GPU Monitor', kit, scaffold }

/**
 * A fresh copy does what it is told. Told only of the polling hook, copies polled for state the
 * backend could push, and a backend reached for `node:fs.watch`, which on macOS drops part of a
 * burst under Bun. Both texts the agent reads must teach the push paths and name the poll the
 * backstop — and every name they teach must exist, or the agent is sent to an API that is gone.
 */
describe('the authoring guidance teaches push before polling', () => {
  const instruction = agentInstruction({ ...input, description: 'Show GPU load', dir: '/p' })
  const guide = agentsMd(input)

  test.each([
    ['the instruction', instruction],
    ['AGENTS.md', guide],
  ])('%s names every push path and the poll as the backstop', (_, text) => {
    for (const phrase of [
      'useStoreSnapshot',
      'wsFrames',
      'createRealtimeFeed',
      'useRealtimeFeed',
      '@localixai/plugin-sdk/ui/realtime-feed',
      'usePluginWorkspaceChanges',
      'ctx.watchPath',
      'node:fs.watch',
      'backstop',
    ]) {
      expect(text, phrase).toContain(phrase)
    }
  })

  // Regression: asked for calories from a photo, a copy stopped to report the kit had no vision
  // API, because nothing told it that the chat agent beside the plugin reads the photo itself.
  test.each([
    ['the instruction', instruction],
    ['AGENTS.md', guide],
  ])('%s says the agent does the understanding and the plugin keeps state', (_, text) => {
    for (const phrase of ['multimodal', 'chat', 'tools', 'vision', 'wakes the agent']) {
      expect(text, phrase).toContain(phrase)
    }
  })

  test('the instruction carries the contract as one line among the others', () => {
    expect(instruction).toContain(LIVE_DATA_CONTRACT)
  })

  // The host's two models are what core search and group routing use; a copy that must pick by
  // itself is pointed at them, with a fallback, instead of wiring a model or a key of its own.
  test.each([
    ['the instruction', instruction],
    ['AGENTS.md', guide],
  ])('%s teaches the host models for the plugin’s own small picks', (_, text) => {
    expect(text).toContain(HOST_JUDGMENT_CONTRACT)
    for (const phrase of ['ctx.host.semantic.rank', 'ctx.host.decisions.decide', 'fallback']) {
      expect(text, phrase).toContain(phrase)
    }
  })

  test('every module and export the guidance names exists', () => {
    const sdk = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'plugin-sdk', 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> }
    expect(Object.keys(sdk.exports)).toEqual(
      expect.arrayContaining(['./ui/realtime-feed', './ui/runtime-hooks']),
    )
    for (const file of ['ui/useStoreSnapshot.ts', 'backend/store-feed.ts']) {
      expect(existsSync(join(templateDir, file)), file).toBe(true)
    }
  })
})
