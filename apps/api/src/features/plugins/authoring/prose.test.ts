import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { PluginKit } from './kit'
import type { PluginKitManifest } from './kit-layout'
import { agentInstruction, agentsMd, LIVE_DATA_CONTRACT } from './prose'
import { loadTemplateScaffold } from './template-layout'

const repoRoot = resolve(import.meta.dir, '../../../../../..')
const templateDir = join(repoRoot, 'plugins', 'template')
const sdkSrc = join(repoRoot, 'packages', 'plugin-sdk', 'src')
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

  test('every module and export the guidance names exists', () => {
    const sdk = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'plugin-sdk', 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> }
    expect(Object.keys(sdk.exports)).toEqual(
      expect.arrayContaining(['./ui/realtime-feed', './ui/runtime-hooks']),
    )
    const source = (file: string) => readFileSync(join(sdkSrc, file), 'utf8')
    expect(source('ui/realtime-feed.ts')).toMatch(/export function createRealtimeFeed\b/)
    expect(source('ui/realtime-feed.ts')).toMatch(/export function useRealtimeFeed\b/)
    expect(source('ui/runtime-hooks.ts')).toMatch(/export function usePluginWorkspaceChanges\b/)
    expect(source('backend/context.ts')).toMatch(/\bwatchPath\?: PluginPathWatch\b/)
    for (const file of ['ui/useStoreSnapshot.ts', 'backend/store-feed.ts']) {
      expect(existsSync(join(templateDir, file)), file).toBe(true)
    }
  })
})
