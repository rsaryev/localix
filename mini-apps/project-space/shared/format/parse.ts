import type { PropsRead, TypeRegistry } from '../registry/registry'
import { emptySpace, type SpaceDocument, type SpaceIssue } from './document'
import { isSpaceId } from './ids'
import { isOrderKey, keysAbove, topKey } from './order'
import { edgeSchema, elementSchema, SPACE_VERSION, spaceFileSchema } from './schema'

/**
 * Read a board file into a document. It never throws, and it never loses a record.
 *
 * The file is edited by hand, by the agent's file tools and by git merges, so every fault is
 * expected and each is answered where it is: a record that cannot be drawn is kept raw and
 * reported by its path, props that do not validate are kept as they are, an unknown type is kept
 * whole. Only a file that cannot be understood AT ALL — not JSON, another format, a newer format
 * version — comes back not `writable`: saving over it would replace the person's file with an
 * empty board, so the store refuses writes until the file is repaired.
 *
 * After a read, every element of a type this build knows carries props at that type's CURRENT
 * version (migrated, validated, defaults filled) and `typeVersions` says so, which is what lets any
 * later reader ask the registry about an element without migrating it twice.
 */
export interface ParsedSpace {
  space: SpaceDocument
  issues: SpaceIssue[]
  writable: boolean
}

export function parseSpace(text: string | null | undefined, registry: TypeRegistry): ParsedSpace {
  if (!text?.trim()) return { space: emptySpace(), issues: [], writable: true }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return unreadable(`The file is not valid JSON: ${(error as Error).message}`)
  }
  const file = spaceFileSchema.safeParse(json)
  if (!file.success) {
    const issue = file.error.issues[0]
    return unreadable(`${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'not a board file'}`)
  }
  if (file.data.version > SPACE_VERSION)
    return unreadable(
      `The board was written by a newer Project Space (format ${file.data.version}); update the app to edit it.`,
    )

  const { format: _format, version: _version, types = {}, elements = {}, edges = {} } = file.data
  const space = emptySpace()
  const issues: SpaceIssue[] = []
  for (const [key, value] of Object.entries(file.data))
    if (!['format', 'version', 'types', 'elements', 'edges'].includes(key)) space.extra[key] = value
  space.typeVersions = { ...types }

  const unordered: string[] = []
  const newer = new Set<string>()
  for (const [id, value] of Object.entries(elements)) {
    const path = `elements.${id}`
    const envelope = elementSchema.safeParse(value)
    if (!isSpaceId(id) || !envelope.success) {
      space.raw.elements[id] = value
      const reason = envelope.success
        ? 'the id is not a valid element id'
        : zodReason(envelope.error)
      issues.push({ path, message: `${reason} — kept in the file, not drawn` })
      continue
    }
    const { props = {}, z, ...rest } = envelope.data
    const read = registry.read(rest.type, props, types[rest.type] ?? 1)
    if (read.status === 'newer') newer.add(rest.type)
    if (read.status !== 'ok')
      issues.push({ path: `${path}.props`, message: readReason(read, rest.type) })
    const validZ = z !== undefined && isOrderKey(z)
    if (z !== undefined && !validZ)
      issues.push({
        path: `${path}.z`,
        message: 'not a stacking key — the element was moved to the top',
      })
    if (!validZ) unordered.push(id)
    space.elements[id] = {
      ...rest,
      z: validZ ? z : '',
      props: read.status === 'ok' ? read.props : props,
    }
  }
  // Elements without a key (the agent and hand edits rarely write one) stack above the rest, in
  // the order the file lists them.
  const top = topKey(Object.values(space.elements).filter((element) => element.z))
  keysAbove(top, unordered.length).forEach((key, index) => {
    const element = space.elements[unordered[index] as string]
    if (element) element.z = key
  })
  for (const spec of registry.all())
    if (!newer.has(spec.type)) space.typeVersions[spec.type] = spec.version

  for (const [id, value] of Object.entries(edges)) {
    const path = `edges.${id}`
    const edge = edgeSchema.safeParse(value)
    if (!isSpaceId(id) || !edge.success || space.elements[id]) {
      space.raw.edges[id] = value
      const reason = !edge.success
        ? zodReason(edge.error)
        : space.elements[id]
          ? 'the id is already an element’s'
          : 'the id is not a valid connector id'
      issues.push({ path, message: `${reason} — kept in the file, not drawn` })
      continue
    }
    space.edges[id] = edge.data
    for (const end of ['from', 'to'] as const)
      if (!space.elements[edge.data[end]])
        issues.push({
          path: `${path}.${end}`,
          message: `no element "${edge.data[end]}" — not drawn`,
        })
  }
  return { space, issues, writable: true }
}

function unreadable(message: string): ParsedSpace {
  return { space: emptySpace(), issues: [{ path: '', message }], writable: false }
}

function zodReason(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0]
  return `${issue?.path.map(String).join('.') || 'record'}: ${issue?.message ?? 'invalid'}`
}

function readReason(read: Exclude<PropsRead, { status: 'ok' }>, type: string): string {
  if (read.status === 'unknown') return `unknown element type "${type}" — kept as it is`
  if (read.status === 'newer')
    return `"${type}" was written by a newer Project Space (version ${read.version}) — kept, read-only here`
  return `${read.message} — kept as it is`
}
