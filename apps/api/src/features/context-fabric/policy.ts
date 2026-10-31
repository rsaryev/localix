import { realpath } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'
import { hasSecretShape } from '../../lib/secret-redaction'
import type { ContextContribution, ResolveContext } from '@localixai/mini-app-sdk/backend'
import type { ContextDropReason } from './manager'

export type ContextPolicyDecision =
  | { ok: true; contribution: ContextContribution }
  | { ok: false; reason: ContextDropReason }

export interface ContextPolicy {
  admit(
    contribution: ContextContribution,
    request: ResolveContext,
    signal: AbortSignal,
  ): Promise<ContextPolicyDecision>
}

const EXCLUDED_SEGMENT = new Set(['.git', '.localix', 'node_modules', 'dist', 'build', '.cache'])
const EXCLUDED_BASENAME = /^(?:\.env(?:\..*)?|credentials(?:\.json)?|id_(?:rsa|ed25519)|\.npmrc)$/i

function excludedRelativePath(root: string, source: string): boolean {
  const parts = relative(root, source).split(sep)
  return (
    parts.some((part) => EXCLUDED_SEGMENT.has(part)) ||
    EXCLUDED_BASENAME.test(parts[parts.length - 1] ?? '')
  )
}

function userExcludedRelativePath(
  root: string,
  source: string,
  exclusions: readonly string[] | undefined,
): boolean {
  if (!exclusions?.length) return false
  const relativePath = relative(root, source).split(sep).join('/')
  return exclusions.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  )
}

/**
 * Host-neutral admission policy for Context Fabric. Filesystem provenance is
 * canonicalized through realpath so symlinks cannot escape the effective workspace;
 * opaque resources deliberately bypass this filesystem-only check.
 */
export function createContextPolicy(): ContextPolicy {
  return {
    async admit(contribution, request, signal) {
      if (signal.aborted) return { ok: false, reason: 'aborted' }
      if (hasSecretShape(contribution.content)) return { ok: false, reason: 'secret' }
      if (!contribution.source) return { ok: true, contribution }
      if (!request.workspace?.rootPath) return { ok: false, reason: 'path_unresolved' }
      try {
        const [root, source] = await Promise.all([
          realpath(request.workspace.rootPath),
          realpath(contribution.source.path),
        ])
        if (signal.aborted) return { ok: false, reason: 'aborted' }
        if (!isPathWithin(root, source)) return { ok: false, reason: 'excluded_uri' }
        if (excludedRelativePath(root, source)) return { ok: false, reason: 'excluded_uri' }
        if (userExcludedRelativePath(root, source, request.workspace.excludedRelativePaths))
          return { ok: false, reason: 'excluded_uri' }
        return { ok: true, contribution: { ...contribution, source: { path: source } } }
      } catch {
        return { ok: false, reason: 'path_unresolved' }
      }
    },
  }
}
