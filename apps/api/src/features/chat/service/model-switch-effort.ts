/**
 * THE LEVEL A SEAT HOLDS AFTER ITS MODEL CHANGES ON THE SERVER (`/model`, route patches).
 *
 * One rule with the picker (`useRowReasoning`), shared through `@localixai/agent`
 * (`reasoning-levels.ts`): staying on the same model keeps the seat's level; moving to another
 * model starts at the level last chosen for this agent on that model, else the default; the result
 * lands on a level the model offers, and a model that does not reason stores `off`.
 */
export { effortForModelSwitch, reasoningForModel as clampEffortToModel } from '@localixai/agent'
