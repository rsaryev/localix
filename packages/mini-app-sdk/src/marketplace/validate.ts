import { PACKAGE_KINDS } from '@localixai/store'

import { MINI_APP_CATEGORIES, MINI_APP_NAME_RE } from '../manifest/primitives'
import { GITHUB_REPO_RE, MARKETPLACE_NAME_RE, MARKETPLACE_SCHEMA, SHA256_RE } from './constants'

/**
 * CHECKING A MARKETPLACE BEFORE IT IS PUBLISHED (`docs/extending/mini-app-marketplace.md`): the
 * strict side of the format, for the file a keeper writes (`.localix-mini-app/marketplace.json`).
 * Localix reads leniently (`read.ts`); this says every way the file would not be read as meant —
 * an unknown field included, so a typo is found before it ships — one line each, `<path>: <fix>`.
 * The checks of Anthropic's community marketplace apply where they fit: sorted unique names,
 * bounded descriptions, https only, no invisible characters.
 */

export interface MarketplaceCheck {
  /** Whether the file may curate: true only for the Localix marketplace. */
  curation: boolean
}

type Raw = Record<string, unknown>

const isRecord = (raw: unknown): raw is Raw =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
const isText = (raw: unknown, min: number, max: number): raw is string =>
  typeof raw === 'string' && raw.trim() === raw && raw.length >= min && raw.length <= max
const isHttps = (raw: unknown): boolean => {
  if (typeof raw !== 'string' || !raw.startsWith('https://')) return false
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MARKETPLACE_FIELDS = [
  '$schema',
  'schema',
  'name',
  'owner',
  'metadata',
  'published',
  'signingKeys',
  'collections',
  'blockedArchives',
  'apps',
]
const BUILT_FIELDS = ['published', 'signingKeys']
const CURATION = ['featured', 'installByDefault', 'suggestFor']
const FACTS = ['displayName', 'description', 'category', 'homepage']
const APP_FIELDS = ['name', 'source', ...FACTS, ...CURATION, 'revoked']
const BUILD = '`mini-app marketplace build`'
const ONLY_LOCALIX = 'only the Localix marketplace curates'

/** Each key of `raw` not in `known`, said at `at`. */
function unknownFields(raw: Raw, known: readonly string[], at: string, of: string): string[] {
  return Object.keys(raw)
    .filter((key) => !known.includes(key))
    .map((key) => `${at}${at ? '.' : ''}${key}: not a field of ${of}`)
}

function ownerProblems(owner: unknown): string[] {
  if (!isRecord(owner) || !isText(owner.name, 1, 120))
    return ['owner.name: who keeps the marketplace']
  return [
    ...unknownFields(owner, ['name', 'email', 'url'], 'owner', 'owner'),
    ...(owner.email !== undefined && !(typeof owner.email === 'string' && EMAIL.test(owner.email))
      ? ['owner.email: an email address']
      : []),
    ...(owner.url !== undefined && !isHttps(owner.url) ? ['owner.url: an https:// address'] : []),
  ]
}

function metadataProblems(metadata: unknown): string[] {
  if (metadata === undefined) return []
  if (!isRecord(metadata)) return ['metadata: an object']
  return [
    ...unknownFields(metadata, ['description'], 'metadata', 'metadata'),
    ...(metadata.description !== undefined && !isText(metadata.description, 1, 2000)
      ? ['metadata.description: 1 to 2000 characters']
      : []),
  ]
}

function collectionProblems(collections: unknown, names: ReadonlySet<string>): string[] {
  if (!Array.isArray(collections)) return ['collections: a list of rows']
  return collections.flatMap((row, index) => {
    const at = `collections[${index}]`
    if (!isRecord(row)) return [`${at}: a row`]
    const items = Array.isArray(row.items) ? row.items : []
    return [
      ...unknownFields(row, ['id', 'title', 'subtitle', 'style', 'items'], at, 'a row'),
      ...(isText(row.id, 1, 64) ? [] : [`${at}.id: 1 to 64 characters`]),
      ...(isText(row.title, 1, 120) ? [] : [`${at}.title: 1 to 120 characters`]),
      ...(row.subtitle === undefined || isText(row.subtitle, 1, 240)
        ? []
        : [`${at}.subtitle: 1 to 240 characters`]),
      ...(row.style === undefined || row.style === 'row' || row.style === 'grid'
        ? []
        : [`${at}.style: row or grid`]),
      ...(Array.isArray(row.items) ? [] : [`${at}.items: the apps and packages it shows`]),
      ...items.flatMap((item, at2) => {
        const where = `${at}.items[${at2}]`
        if (typeof item !== 'string' || !item)
          return [`${where}: an app of this marketplace, or <kind>:<id>`]
        const colon = item.indexOf(':')
        if (colon < 0)
          return names.has(item) ? [] : [`${where}: ${item} is not an app of this marketplace`]
        const kind = item.slice(0, colon)
        return (PACKAGE_KINDS as readonly string[]).includes(kind) && colon < item.length - 1
          ? []
          : [`${where}: an app of this marketplace, or <kind>:<id>`]
      }),
    ]
  })
}

function blockedProblems(blocked: unknown): string[] {
  if (!Array.isArray(blocked)) return ['blockedArchives: a list of archives']
  return blocked.flatMap((entry, index) => {
    const at = `blockedArchives[${index}]`
    if (!isRecord(entry)) return [`${at}: { sha256, reason }`]
    return [
      ...unknownFields(entry, ['sha256', 'reason'], at, 'a blocked archive'),
      ...(typeof entry.sha256 === 'string' && SHA256_RE.test(entry.sha256)
        ? []
        : [`${at}.sha256: the sha256 of the archive, in hex`]),
      ...(isText(entry.reason, 1, 500) ? [] : [`${at}.reason: 1 to 500 characters`]),
    ]
  })
}

/** A folder of this repository: `./…` (or `.`), never climbing out of it. */
const isFolder = (source: string) =>
  (source === '.' || source.startsWith('./')) && !source.split('/').includes('..')

function sourceProblems(app: Raw, at: string): string[] {
  const { source, revoked } = app
  if (source === undefined)
    return isRecord(revoked) && revoked.versions === undefined
      ? []
      : [`${at}.source: where the app is (only an app revoked as a whole has none)`]
  if (typeof source === 'string')
    return isFolder(source) ? [] : [`${at}.source: a folder of this repository, starting with ./`]
  if (!isRecord(source)) return [`${at}.source: a folder ("./…"), github or url`]
  if (source.source === 'archive')
    return [`${at}.source: an archive is written by the build, not by hand`]
  if (source.source === 'github')
    return [
      ...unknownFields(source, ['source', 'repo'], `${at}.source`, 'a github source'),
      ...(typeof source.repo === 'string' && GITHUB_REPO_RE.test(source.repo)
        ? []
        : [`${at}.source.repo: owner/name of a GitHub repository`]),
    ]
  if (source.source === 'url')
    return [
      ...unknownFields(source, ['source', 'url'], `${at}.source`, 'a url source'),
      ...(isHttps(source.url) ? [] : [`${at}.source.url: an https:// address`]),
    ]
  return [`${at}.source: a folder ("./…"), github or url`]
}

/** What a linked app says about itself; a folder's app says it in its own manifest. */
function factProblems(app: Raw, at: string): string[] {
  const linked =
    isRecord(app.source) && (app.source.source === 'github' || app.source.source === 'url')
  if (isRecord(app.source) && !linked) return []
  if (!linked)
    return FACTS.filter((key) => app[key] !== undefined).map(
      (key) => `${at}.${key}: a folder's app says it in its own manifest`,
    )
  return [
    ...(isText(app.description, 10, 2000)
      ? []
      : [`${at}.description: a linked app says what it is, in 10 to 2000 characters`]),
    ...(app.displayName === undefined || isText(app.displayName, 1, 80)
      ? []
      : [`${at}.displayName: 1 to 80 characters`]),
    ...(app.category === undefined ||
    (MINI_APP_CATEGORIES as readonly unknown[]).includes(app.category)
      ? []
      : [`${at}.category: one of ${MINI_APP_CATEGORIES.join(', ')}`]),
    ...(app.homepage === undefined || isHttps(app.homepage)
      ? []
      : [`${at}.homepage: an https:// address`]),
  ]
}

const isWords = (raw: unknown) =>
  Array.isArray(raw) &&
  raw.length <= 20 &&
  raw.every((word) => typeof word === 'string' && word.length > 0 && word.length <= 100)

function curationProblems(app: Raw, at: string, check: MarketplaceCheck): string[] {
  const present = CURATION.filter((key) => app[key] !== undefined)
  if (!check.curation) return present.map((key) => `${at}.${key}: ${ONLY_LOCALIX}`)
  const flags = ['featured', 'installByDefault']
    .filter((key) => app[key] !== undefined && typeof app[key] !== 'boolean')
    .map((key) => `${at}.${key}: true or false`)
  const { suggestFor } = app
  if (suggestFor === undefined) return flags
  if (!isRecord(suggestFor)) return [...flags, `${at}.suggestFor: { files?, dependencies? }`]
  return [
    ...flags,
    ...unknownFields(suggestFor, ['files', 'dependencies'], `${at}.suggestFor`, 'suggestFor'),
    ...['files', 'dependencies']
      .filter((key) => suggestFor[key] !== undefined && !isWords(suggestFor[key]))
      .map((key) => `${at}.suggestFor.${key}: at most 20 words of 1 to 100 characters`),
  ]
}

function revokedProblems(revoked: unknown, at: string): string[] {
  if (revoked === undefined) return []
  if (!isRecord(revoked)) return [`${at}.revoked: { reason, versions? }`]
  const { versions } = revoked
  return [
    ...unknownFields(revoked, ['reason', 'versions'], `${at}.revoked`, 'revoked'),
    ...(isText(revoked.reason, 1, 500)
      ? []
      : [`${at}.revoked.reason: why it is revoked, in 1 to 500 characters`]),
    ...(versions === undefined ||
    (Array.isArray(versions) &&
      versions.length > 0 &&
      versions.every((version) => isText(version, 1, 64)))
      ? []
      : [`${at}.revoked.versions: the versions revoked; leave it out to revoke every one`]),
  ]
}

function appProblems(app: unknown, at: string, check: MarketplaceCheck): string[] {
  if (!isRecord(app)) return [`${at}: an app`]
  const text = [app.name, app.displayName, app.description]
  return [
    ...unknownFields(app, APP_FIELDS, at, 'an app'),
    ...(typeof app.name === 'string' && app.name.length <= 64 && MINI_APP_NAME_RE.test(app.name)
      ? []
      : [`${at}.name: letters, digits, dashes or underscores, at most 64`]),
    ...sourceProblems(app, at),
    ...factProblems(app, at),
    ...curationProblems(app, at, check),
    ...revokedProblems(app.revoked, at),
    ...(['name', 'displayName', 'description'] as const)
      .filter(
        (_, index) => typeof text[index] === 'string' && INVISIBLE.test(text[index] as string),
      )
      .map((key) => `${at}.${key}: holds an invisible character`),
  ]
}

/** Every way `raw`, a marketplace as its keeper writes it, would not be read as meant. */
export function marketplaceProblems(raw: unknown, check: MarketplaceCheck): string[] {
  if (!isRecord(raw)) return ['the file: a JSON object']
  const apps = Array.isArray(raw.apps) ? raw.apps : []
  const names = apps.map((app) => (isRecord(app) && typeof app.name === 'string' ? app.name : ''))
  const unsorted = names.findIndex((name, index) => index > 0 && name < names[index - 1]!)
  const curated = (key: string, problems: () => string[]) =>
    raw[key] === undefined ? [] : check.curation ? problems() : [`${key}: ${ONLY_LOCALIX}`]
  return [
    ...unknownFields(raw, MARKETPLACE_FIELDS, '', 'a marketplace'),
    ...(raw.schema === MARKETPLACE_SCHEMA
      ? []
      : [`schema: ${MARKETPLACE_SCHEMA}, the format this Localix writes`]),
    ...(typeof raw.name === 'string' && MARKETPLACE_NAME_RE.test(raw.name)
      ? []
      : ['name: lower-case words joined by dashes, 2 to 64 characters']),
    ...ownerProblems(raw.owner),
    ...metadataProblems(raw.metadata),
    ...BUILT_FIELDS.filter((key) => raw[key] !== undefined).map(
      (key) => `${key}: written by ${BUILD}, not by hand`,
    ),
    ...curated('collections', () => collectionProblems(raw.collections, new Set(names))),
    ...curated('blockedArchives', () => blockedProblems(raw.blockedArchives)),
    ...(Array.isArray(raw.apps) ? [] : ['apps: the list of apps']),
    ...(unsorted > 0
      ? [`apps: not sorted by name, ${names[unsorted]} comes after ${names[unsorted - 1]}`]
      : []),
    ...apps.flatMap((app, index) => [
      ...(names.indexOf(names[index]!) < index && names[index]
        ? [`apps[${index}].name: ${names[index]} is listed twice`]
        : []),
      ...appProblems(app, `apps[${index}]`, check),
    ]),
  ]
}
