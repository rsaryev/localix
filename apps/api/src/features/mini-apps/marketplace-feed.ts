import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  githubMarketplaceUrl,
  MARKETPLACE_SIGNATURE_SUFFIX,
  readMarketplace,
  type Marketplace,
  type MarketplaceApp,
} from '@localixai/mini-app-sdk/marketplace'
import {
  verifyMarketplaceSignature,
  type MarketplaceSignatures,
} from '@localixai/mini-app-sdk/marketplace-signature'

/**
 * READING A RELEASED MARKETPLACE OVER THE NETWORK (`docs/extending/mini-app-marketplace.md`): the
 * file, its signatures beside it, and every address in it made absolute. It may be served over
 * HTTPS (the Localix marketplace's release, a publisher's GitHub release, Localix Community's) or
 * read from a folder (`file://`); a file it names is resolved against the marketplace's own
 * address, so a marketplace and its archives move together. The format itself is the SDK's
 * (`@localixai/mini-app-sdk/marketplace`); what the signatures mean is `marketplace-trust.ts`'s.
 */

/** An app a marketplace lists by the marketplace it lives in, resolved. */
export interface MarketplaceLink {
  name: string
  /** The released marketplace that holds it. */
  url: string
  description?: string
  displayName?: string
  category?: string
  homepage?: string
}

export interface MarketplaceFeed {
  /** The marketplace, its archives and media addressed absolutely. */
  marketplace: Marketplace
  /** Its linked apps, each by the marketplace it lives in. */
  links: MarketplaceLink[]
  /** The keys whose signatures hold for the bytes read; null when none is published beside it. */
  signatures: MarketplaceSignatures | null
}

type FetchOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal }

/**
 * An address against the marketplace's: HTTPS, or a file beside a marketplace read from a folder.
 * Anything else (plain HTTP, a loopback service) is not fetched.
 */
function resolve(address: string, marketplaceUrl: string): string | null {
  try {
    const url = new URL(address, marketplaceUrl)
    const allowed =
      url.protocol === 'https:' || (url.protocol === 'file:' && marketplaceUrl.startsWith('file:'))
    return allowed ? url.href : null
  } catch {
    return null
  }
}

function resolveFile<T extends { url: string }>(file: T | undefined, at: string): T | undefined {
  const url = file && resolve(file.url, at)
  return file && url ? { ...file, url } : undefined
}

/** An app with every file it names addressed absolutely; null when its archive is nowhere allowed. */
function resolveApp(app: MarketplaceApp, at: string): MarketplaceApp | null {
  let { source } = app
  if (source?.source === 'archive') {
    const url = resolve(source.url, at)
    if (!url) return null
    source = { ...source, url }
  }
  const screenshots = app.screenshots?.flatMap((shot) => resolveFile(shot, at) ?? [])
  const { icon, readme, screenshots: _, ...rest } = app
  const resolvedIcon = resolveFile(icon, at)
  const resolvedReadme = resolveFile(readme, at)
  return {
    ...rest,
    ...(source ? { source } : {}),
    ...(resolvedIcon ? { icon: resolvedIcon } : {}),
    ...(screenshots?.length ? { screenshots } : {}),
    ...(resolvedReadme ? { readme: resolvedReadme } : {}),
  }
}

function linkOf(app: MarketplaceApp, at: string): MarketplaceLink | null {
  const { source } = app
  if (source?.source !== 'github' && source?.source !== 'url') return null
  const url =
    source.source === 'github' ? githubMarketplaceUrl(source.repo) : resolve(source.url, at)
  if (!url) return null
  const { name, description, displayName, category, homepage } = app
  return {
    name,
    url,
    ...(description ? { description } : {}),
    ...(displayName ? { displayName } : {}),
    ...(category ? { category } : {}),
    ...(homepage ? { homepage } : {}),
  }
}

/** The most redirects a marketplace's address may take. */
const REDIRECTS_MAX = 10

/**
 * Fetch a marketplace, following its redirects one by one, and say where its signatures are:
 * beside the last address on the way that still names the marketplace's file. GitHub's
 * `releases/latest/…` leads to the release's own address and then to storage whose address names
 * nothing (a `.sig` appended there only lands in its query, and the marketplace comes back again);
 * `latest` itself may by then be a newer release.
 */
async function fetchFollowing(
  url: string,
  options: FetchOptions,
): Promise<{ response: Response; signedAt: string }> {
  const file = (address: string) => new URL(address).pathname.split('/').at(-1)
  let at = url
  let signedAt = url
  for (let hop = 0; ; hop++) {
    const response = await (options.fetchImpl ?? fetch)(at, {
      signal: options.signal,
      redirect: 'manual',
    })
    const to = response.status >= 300 && response.status < 400 && response.headers.get('location')
    if (!to) return { response, signedAt }
    if (hop === REDIRECTS_MAX) throw new Error(`more than ${REDIRECTS_MAX} redirects`)
    at = new URL(to, at).href
    if (file(at) === file(url)) signedAt = at
  }
}

/** The bytes at `url`: a file read from disk, or fetched with its redirects followed. */
async function readBytes(
  url: string,
  options: FetchOptions,
): Promise<{ bytes: Uint8Array; signedAt: string }> {
  const where = url.startsWith('file:') ? url : new URL(url).host
  if (url.startsWith('file:')) {
    try {
      return { bytes: new Uint8Array(await fs.readFile(fileURLToPath(url))), signedAt: url }
    } catch (error) {
      throw new Error(
        `Could not read the mini app marketplace at ${where}: ${(error as Error).message}`,
      )
    }
  }
  let response: Response
  let signedAt: string
  try {
    ;({ response, signedAt } = await fetchFollowing(url, options))
  } catch (error) {
    throw new Error(
      `Could not reach the mini app marketplace at ${where}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok)
    throw new Error(`The mini app marketplace at ${where} answered ${response.status}`)
  return { bytes: new Uint8Array(await response.arrayBuffer()), signedAt }
}

/**
 * The signatures beside the marketplace read at `signedAt` — the address it came from after
 * redirects, so both are of one release. None published is null; one that cannot be read throws,
 * as the marketplace would: a failed read says nothing about whether it is signed.
 */
async function readSignatures(
  signedAt: string,
  bytes: Uint8Array,
  options: FetchOptions,
): Promise<MarketplaceSignatures | null> {
  const at = `${signedAt}${MARKETPLACE_SIGNATURE_SUFFIX}`
  if (at.startsWith('file:')) {
    const text = await fs.readFile(fileURLToPath(at), 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    return text === null ? null : verifyMarketplaceSignature(bytes, text)
  }
  const response = await (options.fetchImpl ?? fetch)(at, {
    signal: options.signal,
    redirect: 'follow',
  })
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`The marketplace signature at ${new URL(at).host} answered ${response.status}`)
  return verifyMarketplaceSignature(bytes, await response.text())
}

/**
 * A released marketplace with its addresses resolved, its links, and the signatures beside it,
 * checked against the exact bytes it was served as. One that cannot be fetched, is not JSON, is
 * not a marketplace or is of a newer format throws, saying where and why.
 */
export async function readMarketplaceFeed(
  url: string,
  options: FetchOptions = {},
): Promise<MarketplaceFeed> {
  const where = url.startsWith('file:') ? url : new URL(url).host
  const { bytes, signedAt } = await readBytes(url, options)
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`The mini app marketplace at ${where} is not JSON`)
  }
  const read = readMarketplace(body)
  if (read.kind === 'newer')
    throw new Error(
      `The mini app marketplace at ${where} is of schema ${read.schema}, newer than this Localix reads: update Localix`,
    )
  if (read.kind === 'invalid') throw new Error(`${where}: ${read.problem}`)
  const apps = read.marketplace.apps.flatMap((app) => resolveApp(app, url) ?? [])
  return {
    marketplace: { ...read.marketplace, apps },
    links: apps.flatMap((app) => linkOf(app, url) ?? []),
    signatures: await readSignatures(signedAt, bytes, options),
  }
}
