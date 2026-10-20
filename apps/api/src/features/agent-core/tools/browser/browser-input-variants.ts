/**
 * The browser contract a RUN is offered: with or without `take_screenshot` (whether its model reads
 * images) and with or without `goal` (whether a decision model answers for the user now).
 */
import { z } from 'zod'

import { ACTIONS, TAKE_SCREENSHOT, type BrowserAction } from './browser-actions'
import {
  advertisedObject,
  BROWSER_DESCRIPTION,
  browserInputSchema,
  refineBrowserInput,
  textOnlyBrowserInputSchema,
  textOnlyObject,
} from './browser-input'
import { rewriteBrowserArguments } from './browser-lift'

/**
 * The contract a run is offered. Without a decision model that can answer for the user, `goal`
 * and `values` are not advertised at all: a model shown an action that can only answer "no
 * decision model is connected" spends a call learning it. With images withheld as well, the
 * text-only shape below.
 */
const goalFreeActions = (images: boolean) =>
  z
    .enum(
      ACTIONS.filter((action) => action !== 'goal' && (images || action !== TAKE_SCREENSHOT)) as [
        BrowserAction,
        ...BrowserAction[],
      ],
    )
    .optional()

const noGoalBrowserInputSchema = z.preprocess(
  rewriteBrowserArguments,
  refineBrowserInput(
    advertisedObject.omit({ goal: true, values: true }).extend({ action: goalFreeActions(true) }),
  ),
)
const textOnlyNoGoalBrowserInputSchema = z.preprocess(
  rewriteBrowserArguments,
  refineBrowserInput(
    textOnlyObject.omit({ goal: true, values: true }).extend({ action: goalFreeActions(false) }),
  ),
)

/** The schema for a run: whether its model reads images, and whether a decision model answers. */
export function browserInputSchemaFor(options: { images: boolean; goal: boolean }) {
  if (options.images) return options.goal ? browserInputSchema : noGoalBrowserInputSchema
  return options.goal ? textOnlyBrowserInputSchema : textOnlyNoGoalBrowserInputSchema
}

/** The description's `goal` sentence, said only where the action is offered. */
const GOAL_SENTENCE =
  ' Multi-step page work (a form, a search, a date picker): prefer goal — a decision model clicks and types only your values toward it, fast; then verify the page it returns. steps: single precise actions.'

/** The description for a run, with or without the `goal` action. */
export const browserDescription = (goal: boolean) =>
  goal ? BROWSER_DESCRIPTION : BROWSER_DESCRIPTION.replace(GOAL_SENTENCE, '')
