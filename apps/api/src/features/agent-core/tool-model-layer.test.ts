/**
 * The ledger's MODEL layer, end to end through the real registry: a text-only model is not offered
 * what it cannot read. Without it `take_screenshot` reached every model, and a text-only one spent
 * calls on pictures the provider then refused to show it. `read` is the exception by design: it
 * is how a text-only model reads everything else, so it stays and answers an image in text.
 */
import { describe, expect, test } from 'bun:test'

import { CHAT_RUN_PROFILE } from './run-shape'
import { createRuntimeToolRegistry } from './tool-registry'
import { TOOL } from './tool-names'
import { describeWithholdReason, verdictFor } from './tool-ledger'
import { productionCoreDeps, productionOptionalPorts } from './testing/production-ports'

const registryFor = (modelInput: readonly string[] | undefined) =>
  createRuntimeToolRegistry({
    policy: { agentProfile: CHAT_RUN_PROFILE, modelInput },
    core: productionCoreDeps(),
    optional: productionOptionalPorts(),
  })

const acceptsScreenshot = (registry: ReturnType<typeof registryFor>) =>
  registry.tools
    .find((tool) => tool.name === TOOL.Browser)!
    .inputSchema.safeParse({ action: 'take_screenshot' }).success

describe('the model layer', () => {
  test('a text-only model gets browser without take_screenshot, and keeps read', () => {
    const registry = registryFor(['text'])
    expect(registry.toolNames).toContain(TOOL.Browser) // snapshot, steps, evaluate still work
    expect(acceptsScreenshot(registry)).toBe(false)
    expect(registry.toolNames).toContain(TOOL.Read)
    expect(registry.toolNames).not.toContain('view_image')
  })

  test('a model that reads images gets the screenshot action', () => {
    const registry = registryFor(['text', 'image'])
    expect(acceptsScreenshot(registry)).toBe(true)
    expect(registry.toolNames).toContain(TOOL.Read)
  })

  test('an unknown model is not judged, the way authority is not without a surface', () => {
    const registry = registryFor(undefined)
    expect(acceptsScreenshot(registry)).toBe(true)
  })

  test('the layer reads the tool’s own declaration, so a plugin tool is judged the same way', () => {
    const facts = {
      profile: CHAT_RUN_PROFILE,
      authority: undefined,
      disabledTools: new Set<string>(),
      modelInput: ['text'],
    }
    const pluginTool = {
      name: 'chart_png',
      activeVerb: 'Drawing',
      description: 'x',
      inputSchema: {} as never,
      requiresModelInput: ['image'],
      execute: async () => ({ content: '' }),
    }
    const verdict = verdictFor(facts, { name: 'chart_png', tool: pluginTool })
    expect(verdict).toEqual({
      state: 'withheld',
      reason: { layer: 'model', kind: 'modality', needs: 'image' },
    })
    // Nothing a click can change, so nothing is proposed to the model.
    expect('remedy' in verdict).toBe(false)
    if (verdict.state === 'withheld')
      expect(describeWithholdReason(verdict.reason)).toBe("this run's model cannot read images")
  })
})
