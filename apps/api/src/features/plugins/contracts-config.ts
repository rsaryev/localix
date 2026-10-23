import { z } from 'zod'
import { MINI_APP_CONFIG_TYPES } from '@localixai/mini-app-sdk/manifest'

export { miniAppConfigOptionSchema } from '@localixai/mini-app-sdk/manifest'
export type { MiniAppConfigType, MiniAppConfigOption } from '@localixai/mini-app-sdk/manifest'

/** A declared config field plus its current value, masked for secrets. */
export const pluginConfigFieldSchema = z.object({
  key: z.string(),
  type: z.enum(MINI_APP_CONFIG_TYPES),
  description: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  /** Current value for non-secret fields (or its default); always null for secrets. */
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** Whether a value is currently stored (the only thing surfaced for secrets). */
  isSet: z.boolean(),
  /** CC-spec human-readable label for the field. Falls back to the key name when absent. */
  title: z.string().optional(),
  /** CC-spec hint that this field accepts multiple values. */
  multiple: z.boolean().optional(),
  /** CC-spec numeric lower bound hint. */
  min: z.number().optional(),
  /** CC-spec numeric upper bound hint. */
  max: z.number().optional(),
})
export type PluginConfigField = z.infer<typeof pluginConfigFieldSchema>
