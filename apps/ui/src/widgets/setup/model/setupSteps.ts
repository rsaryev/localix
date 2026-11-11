import {
  loadString,
  saveString,
  type StorageReader,
  type StorageWriter,
} from '@localixai/mini-app-sdk/ui/storage'
import type { DefaultModel } from '@/entities/chat/model/defaultProjectModel'

/**
 * The setup dialog's steps, in the order a first chat needs them: a model to answer, a folder to
 * work in, then the optional choices and how the workspace works. Ids are stored (the step setup
 * reopens on), so they stay stable; the title is the step's heading and its row in the step list.
 */
export const SETUP_STEPS = [
  { id: 'model', title: 'Connect a model' },
  { id: 'folder', title: 'Choose a folder' },
  { id: 'preferences', title: 'Preferences' },
  { id: 'basics', title: 'How it works' },
] as const

export type SetupStepId = (typeof SETUP_STEPS)[number]['id']

/** The step setup reopens on, until "Start chatting" finishes it. */
export const SETUP_STEP_KEY = 'localix.setup.step'

const FIRST: SetupStepId = SETUP_STEPS[0].id

const indexOf = (id: SetupStepId) => SETUP_STEPS.findIndex((step) => step.id === id)

/** A stored id read back: anything that is not a step today starts setup at the first one. */
export function resumeStep(saved: string | null): SetupStepId {
  return SETUP_STEPS.find((step) => step.id === saved)?.id ?? FIRST
}

/** The step one ahead (`1`) or one back (`-1`), or null past either end. */
export function stepAfter(id: SetupStepId, delta: 1 | -1): SetupStepId | null {
  return SETUP_STEPS[indexOf(id) + delta]?.id ?? null
}

/** The step's place in the line, from 1. */
export const stepNumber = (id: SetupStepId): number => indexOf(id) + 1

export const loadSetupStep = (storage?: StorageReader): SetupStepId =>
  resumeStep(loadString(SETUP_STEP_KEY, storage))

export const saveSetupStep = (id: SetupStepId, storage?: StorageWriter): void =>
  saveString(SETUP_STEP_KEY, id, storage)

export const forgetSetupStep = (storage?: StorageWriter): void =>
  saveString(SETUP_STEP_KEY, null, storage)

/**
 * Whether a chat can be answered without another choice: a connection that runs, and a model on
 * it, either the one new chats start on or the one the open chat already has.
 */
export function modelChosen(input: {
  runnable: readonly string[]
  defaultModel: DefaultModel | null
  chatModelId: string | null
}): boolean {
  if (input.runnable.length === 0) return false
  if (input.defaultModel) return input.runnable.includes(input.defaultModel.providerConnectionId)
  return Boolean(input.chatModelId)
}
