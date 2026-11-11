import { describe, expect, test } from 'bun:test'
import {
  forgetSetupStep,
  loadSetupStep,
  modelChosen,
  resumeStep,
  saveSetupStep,
  SETUP_STEP_KEY,
  SETUP_STEPS,
  stepAfter,
} from './setupSteps'

/** An in-memory store, so the test needs no DOM. */
function memory() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe('setup steps', () => {
  test('run model, folder, preferences, then how it works', () => {
    expect(SETUP_STEPS.map((step) => step.id)).toEqual(['model', 'folder', 'preferences', 'basics'])
  })

  test('Next and Back walk the line and stop at its ends', () => {
    expect(stepAfter('model', 1)).toBe('folder')
    expect(stepAfter('folder', -1)).toBe('model')
    expect(stepAfter('model', -1)).toBeNull()
    expect(stepAfter('basics', 1)).toBeNull()
  })

  test('a saved step resumes; a missing, old or unknown one starts at the first', () => {
    expect(resumeStep('preferences')).toBe('preferences')
    expect(resumeStep(null)).toBe('model')
    // An id from the old tips carousel, or anything else, is not a step.
    expect(resumeStep('decisions')).toBe('model')
    expect(resumeStep('')).toBe('model')
  })

  test('the step is kept between openings until setup is finished', () => {
    const storage = memory()
    expect(loadSetupStep(storage)).toBe('model')
    saveSetupStep('folder', storage)
    expect(storage.getItem(SETUP_STEP_KEY)).toBe('folder')
    expect(loadSetupStep(storage)).toBe('folder')
    forgetSetupStep(storage)
    expect(storage.getItem(SETUP_STEP_KEY)).toBeNull()
    expect(loadSetupStep(storage)).toBe('model')
  })
})

describe('model step done', () => {
  const pair = { providerConnectionId: 'c1', modelId: 'm1' }

  test('needs a connection that can run', () => {
    expect(modelChosen({ runnable: [], defaultModel: pair, chatModelId: 'm1' })).toBe(false)
  })

  test('is the default model, on a connection that still runs', () => {
    expect(modelChosen({ runnable: ['c1'], defaultModel: pair, chatModelId: null })).toBe(true)
    expect(modelChosen({ runnable: ['c2'], defaultModel: pair, chatModelId: null })).toBe(false)
  })

  test('or the model the open chat already has', () => {
    expect(modelChosen({ runnable: ['c2'], defaultModel: null, chatModelId: 'm2' })).toBe(true)
    expect(modelChosen({ runnable: ['c2'], defaultModel: null, chatModelId: null })).toBe(false)
  })
})
