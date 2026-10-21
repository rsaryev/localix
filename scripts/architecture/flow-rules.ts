import { importsOf, moduleId, resolveSpec, type Rule, type Source } from './kit'

/** UI and change-feed rules: A8 (UI slices), C1, C4 (feed), C6 (store writers), C7 (route gating). */

const UI_SLICE_LAYERS = new Set(['features', 'widgets', 'pages'])
const sliceOf = (file: string | null) => {
  const match = file?.match(/^apps\/ui\/src\/([^/]+)\/([^/]+)/u)
  return match && UI_SLICE_LAYERS.has(match[1]) ? `${match[1]}/${match[2]}` : null
}

export const A8_UI_SLICES: Rule = {
  id: 'A8',
  fix: 'move the shared piece down a layer (shared/ or entities), or compose both slices from the layer above',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      const own = sliceOf(source.file)
      if (!own) continue
      for (const { spec } of importsOf(source)) {
        const other = sliceOf(resolveSpec(source.file, spec))
        if (other && other !== own && other.split('/')[0] === own.split('/')[0])
          found.push(`${own} -> ${other}`)
      }
    }
    return found
  },
}

/**
 * Tables of registered change-feed entities, with the helpers that record their notices. A new
 * registry kind (`apps/api/src/features/changes/core-entities.ts`) adds its tables here.
 */
export const FEED_TABLES: Readonly<Record<string, string>> = {
  agent_sessions: 'chat.session',
  agent_messages: 'chat.message',
}
const RECORD_HELPERS = /\b(?:recordCoreChanges|recordSessionChanges|recordChanges)\s*\(/u

export const C1_WRITES_RECORD_NOTICES: Rule = {
  id: 'C1',
  fix: 'record the notice in the same transaction (recordCoreChanges / recordSessionChanges) or route the write through the owner',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!source.file.startsWith('apps/api/src/') || RECORD_HELPERS.test(source.code)) continue
      for (const table of Object.keys(FEED_TABLES)) {
        const builder = new RegExp(
          `\\.(?:insertInto|updateTable|deleteFrom)\\(\\s*['"]${table}['"]`,
          'u',
        )
        const raw = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'iu')
        if (builder.test(source.code) || raw.test(source.code))
          found.push(`${source.file} writes ${table}`)
      }
    }
    return found
  },
}

const SUBSCRIBE = /\b(?:feed|feedFor\s*\([^)]*\))\s*\.\s*subscribe\s*\(/u

/** C4 reads tests too: `sources` must include `*.test.ts` files. */
export const C4_CONSUMER_TESTS: Rule = {
  id: 'C4',
  fix: 'add a colocated test that drives the consumer with @localixai/change-feed/testing (duplicate, gap, parent deletion)',
  detect(sources) {
    const tests = sources.filter((source) => /\.test\.[jt]sx?$/u.test(source.file))
    const covered = (source: Source) => {
      const id = moduleId(source.file)
      const dir = source.file.slice(0, source.file.lastIndexOf('/'))
      return tests.some((test) =>
        importsOf(test).some(
          ({ spec }) =>
            resolveSpec(test.file, spec) === id ||
            (spec === '@localixai/change-feed/testing' && test.file.startsWith(`${dir}/`)),
        ),
      )
    }
    return sources
      .filter((source) => !tests.includes(source) && SUBSCRIBE.test(source.code))
      .filter((source) => !covered(source))
      .map((source) => `${source.file} subscribes without a consumer test`)
  },
}

/** The chat store's sync layer, which applies server state, and the store that defines the writers. */
export const STORE_WRITER_ALLOWLIST = new Set([
  'apps/ui/src/features/chat/model/sessionSync.ts',
  'apps/ui/src/features/chat/model/store.ts',
])
const PRIVATE_WRITER = /\.\s*(_(?:replace|hydrate)[A-Z]\w*)\b/gu

export const C6_STORE_WRITERS: Rule = {
  id: 'C6',
  fix: 'let the resource sync layer re-read the resource after the relay poke instead of patching the store',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!source.file.startsWith('apps/ui/src/') || STORE_WRITER_ALLOWLIST.has(source.file))
        continue
      for (const match of source.code.matchAll(PRIVATE_WRITER))
        found.push(`${source.file} -> ${match[1]}`)
    }
    return found
  },
}

const PROVIDER_PREFIX = /\.startsWith\(\s*`\$\{[^`}]*provider[^`}]*\}\/`\s*\)/giu

export const C7_ROUTE_READINESS: Rule = {
  id: 'C7',
  fix: 'ask routeReadiness from @localixai/agent/catalog instead of matching a provider prefix',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (source.file.startsWith('packages/agent/src/catalog/')) continue
      if (PROVIDER_PREFIX.test(source.code)) found.push(`${source.file} gates on a provider prefix`)
      PROVIDER_PREFIX.lastIndex = 0
    }
    return found
  },
}
