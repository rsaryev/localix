import { z } from 'zod'
import { MINI_APP_NAME_RE } from '@localixai/mini-app-sdk/manifest-primitives'

/**
 * A catalog: one `catalog.json` that lists mini apps and where each one's archive is. It may be
 * served over HTTPS (the hosted Localix catalog, a publisher's GitHub release) or read from a
 * folder (`file://`); an archive URL is resolved against the catalog's own, so a catalog and its
 * archives move together. Format: `docs/extending/mini-app-publishing.md`.
 */

export const MINI_APP_CATALOG_SCHEMA = 1

const catalogAppSchema = z.object({
  name: z.string().regex(MINI_APP_NAME_RE),
  displayName: z.string().optional(),
  description: z.string().default(''),
  category: z.string().optional(),
  version: z.string().min(1),
  /** The mini app SDK contract it was built against; a newer one waits for a newer Localix. */
  apiVersion: z.number().int().positive().optional(),
  publisher: z.object({ name: z.string().min(1), verified: z.boolean().default(false) }),
  archive: z.object({
    url: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
})
export type MiniAppCatalogApp = z.infer<typeof catalogAppSchema>

const catalogSchema = z.object({
  schema: z.literal(MINI_APP_CATALOG_SCHEMA),
  apps: z.array(z.unknown()),
})

/**
 * The apps a catalog lists. One entry that does not read is left out — a single bad row must
 * not hide a whole catalog — while a catalog that cannot be fetched or is not one throws.
 */
export async function readMiniAppCatalog(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<MiniAppCatalogApp[]> {
  const where = url.startsWith('file:') ? url : new URL(url).host
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      signal: options.signal,
      redirect: 'follow',
    })
  } catch (error) {
    throw new Error(
      `Could not reach the mini app catalog at ${where}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`The mini app catalog at ${where} answered ${response.status}`)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`The mini app catalog at ${where} is not JSON`)
  }
  const parsed = catalogSchema.safeParse(body)
  if (!parsed.success)
    throw new Error(
      `${where} is not a mini app catalog (schema ${MINI_APP_CATALOG_SCHEMA} with an apps list)`,
    )
  return parsed.data.apps.flatMap((raw) => {
    const app = catalogAppSchema.safeParse(raw)
    if (!app.success) return []
    return [
      {
        ...app.data,
        archive: { ...app.data.archive, url: new URL(app.data.archive.url, url).href },
      },
    ]
  })
}
