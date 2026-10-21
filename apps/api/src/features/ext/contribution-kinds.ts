import { UnprocessableError } from '../../lib/domain-errors'
import type { z } from 'zod'
import { stableStringify, textEncoderByteLength } from '@localixai/agent'

import { contributionInputSchema, type ContributionInput } from './contribution-input'
export type { ContributionInput } from './contribution-input'

/** Each native subsystem owns its payload schema. Unknown kinds cannot publish opaque data. */
export function createContributionKindRegistry() {
  const kinds = new Map<string, { schema: z.ZodType }>()
  return {
    register<T>(kind: string, schema: z.ZodType<T>): () => void {
      if (!kind || kinds.has(kind))
        throw new Error(`Invalid or duplicate contribution kind: ${kind}`)
      const registration = { schema }
      kinds.set(kind, registration)
      return () => {
        if (kinds.get(kind) === registration) kinds.delete(kind)
      }
    },
    normalize(inputs: readonly ContributionInput[]) {
      if (inputs.length > 1000)
        throw new UnprocessableError('contribution_limit', 'Too many contributions')
      const keys = new Set<string>()
      let totalBytes = 0
      return inputs.map((input) => {
        const { kind, key, value } = contributionInputSchema.parse(input)
        const registration = kinds.get(kind)
        if (!registration)
          throw new UnprocessableError(
            'unknown_contribution_kind',
            `Unregistered contribution kind: ${kind}`,
          )
        const identity = JSON.stringify([kind, key])
        if (keys.has(identity))
          throw new UnprocessableError('duplicate_contribution', 'Duplicate contribution key')
        keys.add(identity)
        const payload = stableStringify(registration.schema.parse(value))
        const bytes = textEncoderByteLength(payload)
        totalBytes += bytes
        if (bytes > 1024 * 1024 || totalBytes > 16 * 1024 * 1024) {
          throw new UnprocessableError('contribution_limit', 'Contribution exceeds the size limit')
        }
        // Verify that the serialized representation also satisfies the native schema.
        registration.schema.parse(JSON.parse(payload))
        return { kind, key, payload }
      })
    },
  }
}
export type ContributionKindRegistry = ReturnType<typeof createContributionKindRegistry>
