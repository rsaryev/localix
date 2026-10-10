/**
 * Canonical edit-prediction prompt. Localix has one strict-JSON protocol; there
 * is no runtime prompt switch or legacy fallback.
 */

import type { ContextContribution, PredictNextEditRequest } from '../contracts'
import { buildEditPredictionPrompt } from './build'

export interface EditPredictionPrompt {
  /** Stable prompt identity for telemetry/cache namespacing. */
  readonly id: string
  build(
    req: PredictNextEditRequest,
    contextItems?: readonly ContextContribution[],
  ): { systemPrompt: string; userContent: string }
}

export const EDIT_PREDICTION_PROMPT: EditPredictionPrompt = {
  id: 'edit-prediction',
  build: buildEditPredictionPrompt,
}
