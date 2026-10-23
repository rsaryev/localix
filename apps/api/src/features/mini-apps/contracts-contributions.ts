import { z } from 'zod'
import { MINI_APP_NAME_RE } from './contracts-base'

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const modelDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => !containsAsciiControlCharacter(value),
    'Description contains control characters',
  )

/** Max UI views one mini app may declare. */
export const VIEWS_MAX_PER_MINI_APP = 6
/** Max bytes of view HTML served to the UI (matches the inline-widget cap). */
export const MINI_APP_VIEW_HTML_CAP_BYTES = 1.5 * 1024 * 1024
/** Optional Lucide icon NAME hint for a view (host resolves it, falls back to Puzzle). */
export const MINI_APP_VIEW_ICON_RE = /^[a-z][a-z0-9-]{0,39}$/i

/**
 * A declarative UI VIEW — the ONE way a mini app contributes its own screen.
 *
 * Sandboxed HTML from the mini app directory, rendered in an opaque-origin iframe
 * under a strict CSP with the live postMessage bridge, and opened as a WORK-ITEM
 * TAB in the editor grid. There is deliberately no `surface` choice: `panels`
 * (inspector) and rail-mounted views were the same iframe reached through three
 * different placements, which meant three registries, three tab kinds and three
 * doc paragraphs for one capability. A manifest `panels` array is still READ —
 * promoted into this shape before parse — so ported mini apps keep working.
 *
 * Pure manifest DATA; the HTML is read only while the mini app is enabled.
 * `icon` is an optional Lucide name the host maps to a glyph (unknown/absent →
 * the generic Puzzle icon).
 */
export const miniAppViewSchema = z.object({
  id: z
    .string()
    .regex(MINI_APP_NAME_RE, 'View id must be letters, numbers, dashes or underscores.'),
  /** Tab label. */
  title: z.string().min(1).max(40),
  /** HTML file path relative to the mini app directory. */
  file: z.string().min(1),
  /** Optional Lucide icon name hint. */
  icon: z.string().regex(MINI_APP_VIEW_ICON_RE, 'Icon must be a Lucide icon name.').optional(),
  /** Explicit opt-in copy for agent discovery; absent keeps the view user-only. */
  agentDescription: modelDescriptionSchema.optional(),
})

/** One enabled view on the list response (HTML fetched separately on open). */
export const miniAppViewSpecSchema = z.object({
  app: z.string(),
  /** Exact discovery scope needed when HTML/actions are fetched later. */
  projectId: z.string(),
  id: z.string(),
  /** `<app>:<id>` — the stable identity the UI keys tabs by. */
  fullName: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  agentDescription: modelDescriptionSchema.optional(),
})
export type MiniAppViewSpec = z.infer<typeof miniAppViewSpecSchema>

export const miniAppViewHtmlResponseSchema = z.object({ html: z.string() })

/** Stable identifier shape for a mini app's UI → backend operation. */
export const miniAppUiActionNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9._-]{0,63}$/i, 'Invalid mini app UI action name')

export const invokeMiniAppUiActionRequestSchema = z.object({
  app: z.string().min(1),
  projectId: z.string().optional(),
  viewId: z.string().min(1).max(128),
  sessionId: z.string().min(1).optional(),
  action: miniAppUiActionNameSchema,
  payload: z.unknown().optional(),
})
export type InvokeMiniAppUiActionRequest = z.infer<typeof invokeMiniAppUiActionRequestSchema>

export const invokeMiniAppUiActionResponseSchema = z.object({ result: z.unknown() })

/** Caps for manifest prompt sections — the system prompt is shared real estate. */
export const PROMPT_SECTIONS_MAX_PER_MINI_APP = 3
export const PROMPT_SECTION_CONTENT_MAX_CHARS = 2000

/**
 * A declarative system-prompt contribution: rendered under the `# Mini apps`
 * section (prefixed with the mini app name) for every run while the mini app is
 * enabled. Pure manifest DATA — no code involved — so code-free mini apps can
 * shape agent behavior (style guides, domain conventions, tool usage rules).
 */
export const miniAppPromptSectionSchema = z.object({
  title: z.string().min(1).max(80),
  content: z.string().min(1).max(PROMPT_SECTION_CONTENT_MAX_CHARS),
})
