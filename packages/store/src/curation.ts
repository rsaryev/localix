import { z } from 'zod'

/**
 * CURATION: what a marketplace's keeper chooses to show, as opposed to what a package is
 * (`docs/extending/mini-app-marketplace.md`, "Curation"). A mini app marketplace states it on each
 * app; a Claude Code marketplace under each plugin's `localix` key, a field Claude Code ignores.
 * The Store honours it only from a source Localix trusts (an editorial default source).
 */

const suggestWords = z.array(z.string().min(1).max(100)).max(20)

/**
 * What a package is suggested for: file names at a project's root or open in a tab
 * (`compose.yaml`, `*.tf`; `*` stands for any characters) and packages a project depends on
 * (`prisma`, `@sentry/node`). Recommendations show it where they are (`recommend-rules.ts`).
 */
export const suggestForSchema = z.object({
  files: suggestWords.optional(),
  dependencies: suggestWords.optional(),
})
export type SuggestFor = z.infer<typeof suggestForSchema>

/** The strings among `raw` that fit a suggestion word, as many as a listing holds. */
const looseWords = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw
        .filter((word): word is string => typeof word === 'string')
        .filter((word) => word.length > 0 && word.length <= 100)
        .slice(0, 20)
    : []

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

/** A source's `suggestFor`, read leniently: what is not a word is dropped; nothing is undefined. */
export function readSuggestFor(raw: unknown): SuggestFor | undefined {
  if (!isRecord(raw)) return undefined
  const files = looseWords(raw.files)
  const dependencies = looseWords(raw.dependencies)
  if (!files.length && !dependencies.length) return undefined
  return {
    ...(files.length ? { files } : {}),
    ...(dependencies.length ? { dependencies } : {}),
  }
}

export interface Curation {
  /** In Discover's featured carousel. */
  featured?: true
  /** Installed on its own, once, on a new installation. */
  installByDefault?: true
  suggestFor?: SuggestFor
}

/**
 * One entry's curation, read leniently: each pick that does not read is dropped alone, and what
 * says nothing (`false`, an empty suggestion) is left out, so the result names only what is chosen.
 */
export function readCuration(raw: unknown): Curation {
  if (!isRecord(raw)) return {}
  const suggestFor = readSuggestFor(raw.suggestFor)
  return {
    ...(raw.featured === true ? { featured: true } : {}),
    ...(raw.installByDefault === true ? { installByDefault: true } : {}),
    ...(suggestFor ? { suggestFor } : {}),
  }
}
