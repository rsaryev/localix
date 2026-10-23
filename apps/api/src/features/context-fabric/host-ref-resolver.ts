import { resolve as resolvePath } from 'node:path'

import { CONTEXT_UNAVAILABLE_KIND } from '@localixai/mini-app-sdk/backend'

import { formatRefExpansionBlock } from '../../contracts/context-refs'
import { refKindSpec } from '../../contracts/context-ref-kinds'
import { contextRefSchema, type ContextRef, type ContextRefExpansion } from '../projects/contracts'
import type {
  ContextContribution,
  ContextReference,
  ContextResolver,
  ResolveContext,
} from './contracts'

/**
 * Context Fabric's resolver for the references core itself owns — `@file`, `@folder`, `@session`,
 * `@message`, `@terminal`, `@call`, `@project`, and inline snippets.
 *
 * These used to be resolved by a SECOND path: a sent message took Fabric for `resource` refs and
 * `projectsService.expandRefs` for everything else, and inline completion took only the latter.
 * Two paths meant two exclusion lists, a secret check on one and not the other, and no workspace
 * exclusions at all for a linked file. This resolver keeps the expanders (they are the one owner
 * of how each kind reads) and puts their output through the same admission as every provider:
 * a file contribution carries `source.path`, so realpath containment, the built-in excluded
 * segments and the user's `contextExclusions` apply to it exactly as to a plugin's.
 */

export interface HostRefExpander {
  (
    userId: string,
    input: { workingDir: string; refs: ContextRef[]; sessionId?: string },
  ): Promise<ContextRefExpansion[]>
}

export const HOST_REF_PROVIDER = { id: 'localix.context', version: '1' } as const

/** Rebuild the expander's input from a reference. The schema, not a field list, decides what passes. */
export function hostRefFromReference(reference: ContextReference): ContextRef | null {
  const parsed = contextRefSchema.safeParse({
    ...reference.attributes,
    raw: reference.presentation.token || `@${reference.kind}:${reference.presentation.label}`,
    kind: reference.kind,
    ...(reference.uri ? { uri: reference.uri } : {}),
    label: reference.presentation.label.slice(0, 512),
  })
  return parsed.success && parsed.data.kind !== 'resource' ? parsed.data : null
}

function contribution(
  reference: ContextReference,
  ref: ContextRef,
  expansion: ContextRefExpansion,
  workspace: ResolveContext['workspace'],
): ContextContribution {
  const readsFile = expansion.ok && (ref.kind === 'file' || ref.kind === 'folder') && ref.path
  return {
    id: `host:${reference.id}`,
    providerId: HOST_REF_PROVIDER.id,
    providerVersion: HOST_REF_PROVIDER.version,
    scope: 'session',
    kind: expansion.ok ? ref.kind : CONTEXT_UNAVAILABLE_KIND,
    content: formatRefExpansionBlock(expansion),
    ...(readsFile && workspace
      ? { source: { path: resolvePath(workspace.rootPath, ref.path!) } }
      : {}),
    ...(ref.startLine
      ? {
          range: {
            start: { line: ref.startLine - 1, character: 0 },
            end: { line: (ref.endLine ?? ref.startLine) - 1, character: 0 },
          },
        }
      : {}),
    priority: 1000,
    sensitivity: 'project',
    relevanceHints: { explicit: true },
  }
}

export function createHostRefResolver(expand: HostRefExpander): ContextResolver {
  return {
    ...HOST_REF_PROVIDER,
    supports: (reference) => hostRefFromReference(reference) !== null,
    // Sizing a host ref IS reading it; the manager does not pre-size explicit refs anyway.
    estimate: async () => ({ bytes: 0 }),
    async resolve(reference, ctx, signal) {
      const ref = hostRefFromReference(reference)
      if (!ref || signal.aborted) return []
      // A filesystem ref without a trusted root would resolve against the process cwd.
      if (refKindSpec(ref.kind).needsWorkingDir && !ctx.workspace?.rootPath) {
        return [
          contribution(
            reference,
            ref,
            { raw: ref.raw, ok: false, error: 'no workspace for this session', chars: 0 },
            undefined,
          ),
        ]
      }
      const [expansion] = await expand(ctx.userId, {
        workingDir: ctx.workspace?.rootPath ?? '',
        refs: [ref],
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      })
      if (!expansion || signal.aborted) return []
      return [contribution(reference, ref, expansion, ctx.workspace)]
    },
  }
}
