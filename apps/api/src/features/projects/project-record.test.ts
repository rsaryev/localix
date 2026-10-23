import { expect, test } from 'bun:test'
import { applyProjectSettingsPatch } from './project-record'
import type { ProjectSettings, ProjectSettingsPatch } from './contracts'

test('settings patches accept frozen inputs and preserve omitted fields without mutating either', () => {
  const current: ProjectSettings = {
    modelId: 'model',
    customSystemPrompt: 'Keep this prompt',
    contextExclusions: ['**/.env'],
  }
  const patch: ProjectSettingsPatch = { modelId: null, customSystemPrompt: undefined }
  Object.freeze(current.contextExclusions)
  Object.freeze(current)
  Object.freeze(patch)

  expect(applyProjectSettingsPatch(current, patch)).toEqual({
    customSystemPrompt: 'Keep this prompt',
    contextExclusions: ['**/.env'],
  })
  expect(current.modelId).toBe('model')
  expect(patch).toEqual({ modelId: null, customSystemPrompt: undefined })
})
