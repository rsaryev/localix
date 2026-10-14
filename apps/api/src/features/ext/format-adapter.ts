import { z } from 'zod'

/** The caller owns source identity and reads bytes; a format adapter only decodes them. */
export interface FormatArtifact {
  format: string
  version: number
  source: string
  text: string
}

const diagnosticSchema = z.strictObject({
  field: z.string(),
  status: z.enum(['supported', 'translated', 'unsupported', 'invalid']),
  impact: z.enum(['presentation', 'execution', 'authority']),
  message: z.string(),
})
export type FormatDiagnostic = z.infer<typeof diagnosticSchema>

const decodedSchema = z.strictObject({
  value: z.unknown(),
  diagnostics: z.array(diagnosticSchema),
})

export interface FormatAdapter {
  format: string
  version: number
  /** No filesystem, registry writes, permission grants or execution in this port. */
  decode(text: string): { value: unknown; diagnostics: FormatDiagnostic[] }
}

export type AdaptedArtifact<T> = {
  source: string
  format: string
  version: number
  diagnostics: FormatDiagnostic[]
} & ({ status: 'accepted'; value: T } | { status: 'rejected' })

const invalid = (field: string, message: string): FormatDiagnostic => ({
  field,
  status: 'invalid',
  impact: 'execution',
  message,
})

/**
 * Explicit version selection prevents a failed decode from falling through to a more permissive
 * dialect. Every adapter result crosses the same host-owned schema. The target can be a native
 * definition or a typed contribution bundle; provenance and diagnostics never enter that value.
 */
export function createFormatAdapterRegistry<T>(schema: z.ZodType<T>, maxBytes = 1024 * 1024) {
  const adapters = new Map<string, FormatAdapter>()
  const key = (format: string, version: number) => JSON.stringify([format, version])

  return {
    register(adapter: FormatAdapter): () => void {
      if (!adapter.format || !Number.isSafeInteger(adapter.version) || adapter.version < 1) {
        throw new Error('A format adapter needs a format and a positive integer version')
      }
      const id = key(adapter.format, adapter.version)
      if (adapters.has(id)) throw new Error(`Format adapter already registered: ${id}`)
      // Snapshot the registration so mutating the caller's descriptor cannot change its owner.
      const owned = { ...adapter }
      adapters.set(id, owned)
      return () => {
        if (adapters.get(id) === owned) adapters.delete(id)
      }
    },

    decode(artifact: FormatArtifact): AdaptedArtifact<T> {
      const provenance = {
        source: artifact.source,
        format: artifact.format,
        version: artifact.version,
      }
      const reject = (diagnostics: FormatDiagnostic[]): AdaptedArtifact<T> => ({
        ...provenance,
        status: 'rejected',
        diagnostics,
      })
      const adapter = adapters.get(key(artifact.format, artifact.version))
      if (!adapter) return reject([invalid('', 'No adapter registered for this format version')])
      if (new TextEncoder().encode(artifact.text).byteLength > maxBytes) {
        return reject([invalid('', 'Artifact exceeds the decoding size limit')])
      }
      let decoded: z.infer<typeof decodedSchema>
      try {
        const result = decodedSchema.safeParse(adapter.decode(artifact.text))
        if (!result.success) return reject([invalid('', 'Invalid adapter result envelope')])
        decoded = result.data
      } catch {
        // Parser errors can contain the artifact's private contents. Keep diagnostics structural.
        return reject([invalid('', 'Artifact could not be decoded')])
      }
      const diagnostics = decoded.diagnostics
      if (
        diagnostics.some(
          (item) =>
            item.status === 'invalid' ||
            (item.status === 'unsupported' && item.impact !== 'presentation'),
        )
      )
        return reject(diagnostics)
      const validated = schema.safeParse(decoded.value)
      if (!validated.success) {
        return reject([
          ...diagnostics,
          ...validated.error.issues.map((issue) =>
            invalid(issue.path.join('.'), `Native contract validation failed: ${issue.code}`),
          ),
        ])
      }
      return { ...provenance, status: 'accepted', value: validated.data, diagnostics }
    },
  }
}
