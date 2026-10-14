import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  makeHelpers,
  type PluginContext,
  type PluginHooks,
  type AssistantMessageEvent,
} from '../../../apps/api/src/features/plugins/native'

/**
 * Behavior tests for the bundled `deliverable` plugin (plugins/deliverable):
 * its onAssistantMessage hook turns prose-mentioned file paths into message
 * bindings. Imported directly — same module the loader imports when enabled.
 */

const PLUGIN_DIR = resolve(import.meta.dir, '..')

function makeCtx(config: Record<string, string | number | boolean> = {}): PluginContext {
  return {
    pluginName: 'deliverable',
    pluginDir: PLUGIN_DIR,
    cwd: process.cwd(),
    config,
    log: () => {},
    helpers: makeHelpers(),
  } as unknown as PluginContext
}

let dir: string
let hooks: PluginHooks
let pngPath: string

const run = (content: string, h: PluginHooks = hooks) =>
  Promise.resolve(
    h.onAssistantMessage!({
      sessionId: 's1',
      messageId: 'm1',
      content,
    } satisfies AssistantMessageEvent),
  )

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'deliverable-'))
  pngPath = join(dir, 'chart.png')
  await fs.writeFile(pngPath, Buffer.from('89504e470d0a1a0a', 'hex'))
  const mod = await import(join(PLUGIN_DIR, 'hooks', 'index.mjs'))
  hooks = mod.register(makeCtx()).hooks
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('deliverable plugin', () => {
  it('attaches an existing image mentioned in prose', async () => {
    const out = await run(`Here is your chart: ${pngPath}`)
    expect(out).toBeTruthy()
    const atts = (
      out as { bindings: Array<{ kind: string; name: string; mediaType: string; size: number }> }
    ).bindings
    expect(atts.length).toBe(1)
    expect(atts[0]).toMatchObject({
      kind: 'image',
      name: 'chart.png',
      mediaType: 'image/png',
      size: 8,
    })
  })

  it('ignores nonexistent paths and non-whitelisted extensions', async () => {
    expect(await run(`See ${dir}/missing.png and ${dir}/script.sh`)).toBeUndefined()
  })

  it('ignores paths inside code blocks and inline code', async () => {
    expect(await run(`Use \`${pngPath}\` like:\n\`\`\`\nopen ${pngPath}\n\`\`\``)).toBeUndefined()
  })

  it('deduplicates repeated mentions of the same file', async () => {
    const out = await run(`${pngPath} and again ${pngPath}`)
    expect((out as { bindings: unknown[] }).bindings.length).toBe(1)
  })

  it('respects the MAX_FILE_MB cap from config', async () => {
    const tiny = (await import(join(PLUGIN_DIR, 'hooks', 'index.mjs'))).register(
      makeCtx({ MAX_FILE_MB: 0 }),
    ).hooks as PluginHooks
    expect(await run(`Made ${pngPath}`, tiny)).toBeUndefined()
  })

  it('STRIP_PATHS removes bare path lines but keeps prose mentions', async () => {
    const stripping = (await import(join(PLUGIN_DIR, 'hooks', 'index.mjs'))).register(
      makeCtx({ STRIP_PATHS: true }),
    ).hooks as PluginHooks
    const out = (await run(`Done! File:\n- ${pngPath}\nWhat next?`, stripping)) as {
      content?: string
      bindings: unknown[]
    }
    expect(out.bindings.length).toBe(1)
    expect(out.content).toBe('Done! File:\nWhat next?')
  })
})
