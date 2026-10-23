import { resolve } from 'node:path'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { describeSpace } from '../shared/agent/describe'
import { buildOpSchemas, type SpaceOp } from '../shared/ops/contract'
import { SPACE_TOOLS, spaceUri } from '../shared/resource'
import { ELEMENT_TYPES, spaceTypes } from '../shared/types'
import { spacePaths } from './paths'
import { missingReferences } from './references'
import { SpaceRefusal, spaceStore } from './space-store'

/**
 * The agent's two doors to the project's board: read it as a roster, change it with a batch of
 * operations. The same store and the same operations the view uses, so what the agent does is on
 * the person's screen at the next poll and a person's edit is in the agent's next read.
 *
 * The element types in the descriptions are generated from the registry: a new type is known to
 * the agent the moment it is registered, with the fields its spec declares — never a hand-kept
 * list in a prompt that drifts from what the board accepts.
 */
export type ResolveRoot = (sessionId: string | undefined) => Promise<string>

export function createSpaceTools(ctx: MiniAppContext, resolveRoot: ResolveRoot) {
  const z = ctx.z
  const ops = buildOpSchemas(z).ops
  const types = ELEMENT_TYPES.map(
    (spec) => `${spec.type}: ${spec.description} Default size ${spec.size.w}×${spec.size.h}.`,
  ).join('\n')
  // The board file the gate is shown for `apply`, and the only one `apply` will write.
  const declaredBoard = resolve(spacePaths(ctx.cwd).file)
  const reveal = (sessionId: string | undefined) =>
    sessionId ? ctx.ui.offer({ uri: spaceUri(sessionId), label: 'Open Project Space' }) : undefined

  const read = ctx.defineTool({
    name: SPACE_TOOLS.read,
    label: 'Read Project Space',
    activeVerb: 'Reading the board',
    description: `Read the project’s spatial board (Project Space) as a roster, bottom to top: one line per element — \`[id] type (x,y w×h)\` then its marks: \`in <frame>\`, \`group inner<outer\` (the group ids that order/align/ungroup take), \`locked\`, \`opacity N\`, its text, and \`— MISSING on disk\` for a reference whose file is gone — then one arrow per connector. READ ONLY — it takes filters (frame, ids, query), never operations; change the board with ${SPACE_TOOLS.apply}, show part of it with ${SPACE_TOOLS.view}. Referenced files are named by path — read them with your file tools.`,
    inputSchema: z.object({
      frame: z.string().optional().describe('Only what this frame holds.'),
      ids: z
        .array(z.string())
        .optional()
        .describe(
          'Only these elements; includes complete validated props, native content and diagram source.',
        ),
      query: z
        .string()
        .optional()
        .describe(
          'Only elements whose id, type or text contains every word of this, in any order.',
        ),
    }),
    executionMode: 'parallel',
    mutates: false,
    behaviorHints: { readOnlyHint: true },
    permissionPaths: () => [],
    async execute(_id, input, _signal, _onUpdate, context) {
      const root = await resolveRoot(context?.session?.id)
      const snapshot = await spaceStore.read(root, 'agent')
      const missing = new Set(await missingReferences(root, snapshot.space))
      return {
        content: describeSpace(snapshot.space, spaceTypes, {
          ...input,
          missing,
          issues: snapshot.issues,
        }),
      }
    },
  })

  const apply = ctx.defineTool({
    name: SPACE_TOOLS.apply,
    label: 'Change Project Space',
    activeVerb: 'Arranging the board',
    description: [
      'Change the project’s spatial board with a batch of operations, applied in order and each on its own: a refused operation is reported and the others still land, so fix only the refused ones. Give create an id to connect it in the same batch. Omit x/y and use `in` (a frame) or `near` (an element) to have a free spot found. Files, folders, images and documents are references by path — relative inside the project. Pick the type that IS the thing: use `sequence` for a diagram edited as participants and messages, `mermaid` with props.source for complete Mermaid grammar (including branches and loops), and `shape`s joined by `connect` for individually editable flow nodes. Lay out with operations rather than computed coordinates: `arrange` (row, column, grid; `in` a frame lays out what it holds and fits the frame), `align`, `distribute`. `group` what belongs together and name the group id wherever ids are taken; `order` stacks (front, forward, backward, back). Frames are always drawn beneath everything else, so a frame’s background picture is an image `in` it with fit cover, sized to it, sent to the back and locked. A locked element changes only in an update that also passes locked: false. ' +
        `To show the person what you laid out, use ${SPACE_TOOLS.view}; take a screenshot (browser at mini-app:project-space) only when how it looks matters.`,
      'Element types:',
      types,
    ].join('\n'),
    inputSchema: z.object({ ops }),
    executionMode: 'sequential',
    mutates: true,
    // Undeclared, the call classed as `external` — wider than the one board file it writes.
    classify: () => ({ effect: 'files' }),
    // The one file the call writes: the permission rules see a write inside the project, as they
    // would for the agent's own edit of it. Referenced files are only named, never written.
    permissionPaths: () => [declaredBoard],
    async execute(_id, input, _signal, _onUpdate, context) {
      const root = await resolveRoot(context?.session?.id)
      // THE GATE MUST HAVE JUDGED THE FILE THIS CALL WRITES. `permissionPaths` is synchronous and
      // sees no session, so it can only name the board under `ctx.cwd`, while the write goes under
      // the session's root, resolved here. The two agree whenever the host is consistent; when
      // they do not (the project's directory moved after the tools loaded, a host whose scope
      // answers differently), writing anyway would let a path rule approve one file and the call
      // change another. So the write happens only to the file that was declared, and any other
      // root is refused before the store is touched.
      if (resolve(spacePaths(root).file) !== declaredBoard) {
        return {
          content: `This chat's board is at ${spacePaths(root).file}, not at ${declaredBoard} where the permission check looked; nothing was changed. Retry in a new turn.`,
          isError: true,
        }
      }
      try {
        const { results } = await spaceStore.apply(root, input.ops as SpaceOp[], 'agent')
        const lines = results.map((result, index) => {
          const op = input.ops[index] as SpaceOp
          return result.ok
            ? `${index + 1}. ${op.op} ${result.id}${result.note ? ` ${result.note}` : ''}`
            : `${index + 1}. REFUSED ${op.op}: ${result.error}`
        })
        const refused = results.filter((result) => !result.ok).length
        const summary = refused
          ? `${results.length - refused} of ${results.length} applied; the refused ones changed nothing.`
          : `All ${results.length} applied.`
        return {
          content: [summary, ...lines].join('\n'),
          // A batch where nothing landed is a call that did nothing: that, and only that, fails.
          isError: refused === results.length,
          details: { reveal: reveal(context?.session?.id) },
        }
      } catch (error) {
        if (error instanceof SpaceRefusal) return { content: error.message, isError: true }
        throw error
      }
    },
  })

  return [read, apply]
}
