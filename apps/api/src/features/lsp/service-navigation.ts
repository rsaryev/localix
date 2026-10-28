import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimit } from '../../lib/map-limit'
import type { LspPosition, LspRange } from './lsp-response-types'
import type { LspManager } from './lsp-manager-types'
import type { LspDocumentService } from './service-contract'
import type { CodeLocation, CodeReference, WorkspaceSymbol } from './service-result-types'

const uriToPath = (uri: string): string | null => {
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}

const DEFINITION_SELF_RETRY_MS = [75, 150, 300, 600, 600] as const
const MAX_DEFINITION_RESULTS = 64

function positionInRange(position: LspPosition, range: LspRange): boolean {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character)
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line && position.character <= range.end.character)
  return afterStart && beforeEnd
}

/**
 * During initial TypeScript project loading vtsls can temporarily return the
 * import binding itself as its own definition. Monaco then opens the exact same
 * cursor span, which looks like Cmd+Click did nothing. A real local declaration
 * reached from a usage has a different span, so this predicate isolates that
 * transient response without delaying normal local-variable/function navigation.
 */
function isSelfDefinition(
  file: string,
  position: LspPosition,
  location: { uri: string; range: LspRange },
): boolean {
  return uriToPath(location.uri) === file && positionInRange(position, location.range)
}

async function readLinePreview(
  path: string,
  line: number,
  cache: Map<string, Promise<string[]>>,
): Promise<string> {
  try {
    let read = cache.get(path)
    if (!read) {
      read = Bun.file(path)
        .text()
        .then((text) => text.split('\n'))
      cache.set(path, read)
    }
    const lines = await read
    const text = (lines[line] ?? '').trim()
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return ''
  }
}

/**
 * Shape raw LSP locations into `CodeReference[]` (absolute path + label + 0-based
 * position + a one-line preview) — the single form the references peek renders.
 * Shared by `references`, `implementation`, and `typeDefinition` so all three feed
 * the SAME peek UI. Unresolvable uris are skipped; the line cache is reused across
 * a single call so repeated hits in one file read the file once.
 */
async function toReferences(
  locs: { uri: string; range: { start: { line: number; character: number } } }[],
): Promise<CodeReference[]> {
  const cache = new Map<string, Promise<string[]>>()
  const refs = await mapLimit(locs, 16, async (loc): Promise<CodeReference | null> => {
    const path = uriToPath(loc.uri)
    if (!path) return null
    return {
      file: path,
      fileLabel: basename(path),
      line: loc.range.start.line,
      character: loc.range.start.character,
      preview: await readLinePreview(path, loc.range.start.line, cache),
    }
  })
  return refs.filter((ref): ref is CodeReference => ref !== null)
}

interface NavigationPorts {
  getManager: () => LspManager
  resolveProjectRoot: (userId: string, sessionId: string) => Promise<string>
  projectRootAfterSync: (userId: string, sessionId: string, file: string) => Promise<string>
}

/** Project navigation waits for the service's buffer barrier before querying a file. */
export function createServiceNavigation({
  getManager,
  resolveProjectRoot,
  projectRootAfterSync,
}: NavigationPorts): Pick<
  LspDocumentService,
  'workspaceSymbols' | 'definition' | 'implementation' | 'typeDefinition' | 'references'
> {
  return {
    async workspaceSymbols(userId, sessionId, query) {
      const trimmed = query.trim()
      if (!trimmed) return []
      const projectRoot = await resolveProjectRoot(userId, sessionId)
      const raw = await getManager().workspaceSymbols(projectRoot, trimmed)
      const out: WorkspaceSymbol[] = []
      const seen = new Set<string>()
      for (const s of raw) {
        const path = uriToPath(s.uri)
        if (!path) continue
        // Merge duplicates the same symbol can produce across overlapping servers.
        const key = `${s.name}:${path}:${s.line}:${s.character}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          name: s.name,
          kind: s.kind,
          containerName: s.containerName,
          file: path,
          line: s.line,
          character: s.character,
        })
      }
      return out.slice(0, 200)
    },

    async definition(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      let locations = await getManager().definition(projectRoot, file, position)
      for (const delay of DEFINITION_SELF_RETRY_MS) {
        if (
          locations.length === 0 ||
          locations.some((loc) => !isSelfDefinition(file, position, loc))
        ) {
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
        locations = await getManager().definition(projectRoot, file, position)
      }
      const hasExternalTarget = locations.some((loc) => !isSelfDefinition(file, position, loc))
      const seen = new Set<string>()
      const resolved: CodeLocation[] = []
      for (const loc of locations) {
        if (hasExternalTarget && isSelfDefinition(file, position, loc)) continue
        const path = uriToPath(loc.uri)
        if (!path) continue
        const key = `${path}:${loc.range.start.line}:${loc.range.start.character}`
        if (seen.has(key)) continue
        seen.add(key)
        resolved.push({
          file: path,
          line: loc.range.start.line,
          character: loc.range.start.character,
        })
        if (resolved.length >= MAX_DEFINITION_RESULTS) break
      }
      return resolved
    },

    async implementation(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await getManager().implementation(projectRoot, file, position))
    },

    async typeDefinition(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await getManager().typeDefinition(projectRoot, file, position))
    },

    async references(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await getManager().references(projectRoot, file, position))
    },
  }
}
