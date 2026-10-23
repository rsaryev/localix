/**
 * Kubernetes workbench error mapping. A kubeconfig can be missing, authentication can
 * fail, or the selected API server can be unreachable — each must surface as a clean
 * typed code the UI renders as a quiet empty state, NEVER an unhandled 500. Client
 * errors are classified into a small stable vocabulary; the raw text is kept as
 * `detail` for operators.
 *
 * The typed-error SKELETON (the error class, `toErrorInfo`, `rawOf`) is the shared
 * `defineTypedError` kit — four workbenches had hand-rolled it identically. What stays
 * here is the only part with domain content in it: the FRIENDLY sentences and
 * {@link mapKubeError}'s stderr classification.
 */

// `/typed-error`, not `/backend`: `resource-nodes.ts` imports `mapKubeError` from here, and the
// UI's `resourceLink.ts` imports the URI builders from THAT — so this file is browser-reachable.
// The `./backend` barrel re-exports `net-safety`, which touches `node:dns`, and Vite externalizes
// that to a stub which throws on first property access. The whole DevOps mini app then failed to
// register its UI with "Module node:dns has been externalized for browser compatibility", and
// because the failure is caught per-mini-app it surfaced only as a missing workspace.
import { defineTypedError, type TypedDomainError } from '@localixai/mini-app-sdk/typed-error'
import { isMissingExecutable } from '@localixai/mini-app-sdk/prerequisite'
import { credentialHelperPrerequisite } from './local-cluster'

export type KubeErrorCode =
  | 'no_kubeconfig'
  | 'authentication_failed'
  | 'permission_denied'
  | 'invalid_context'
  | 'certificate_error'
  | 'command_timeout'
  | 'context_unreachable'
  | 'not_found'
  | 'port_forward_failed'
  | 'manifest_apply_failed'
  /** The REQUEST was malformed — not a cluster failure. Produced by the route validator. */
  | 'invalid_request'
  /** A program the kubeconfig runs (a credential helper) is not installed. */
  | 'tool_missing'
  | 'kube_error'

const FRIENDLY: Record<KubeErrorCode, string> = {
  no_kubeconfig: 'No kubeconfig found — configure a cluster (e.g. ~/.kube/config), then Refresh.',
  authentication_failed:
    'Cluster authentication failed — refresh the credentials for the selected context, then Refresh.',
  permission_denied:
    'Access denied by Kubernetes RBAC — the current identity cannot read or change this resource.',
  invalid_context: 'The selected kubeconfig context no longer exists — choose another context.',
  certificate_error:
    'The cluster certificate could not be verified — check the kubeconfig certificate and server name.',
  command_timeout: 'The Kubernetes API did not respond before the safety timeout.',
  context_unreachable: 'Cannot reach this cluster right now.',
  not_found: 'Resource not found.',
  port_forward_failed: 'Could not start the port-forward.',
  invalid_request: 'The request was not valid.',
  manifest_apply_failed: 'The manifest was rejected — see the validation error below.',
  tool_missing: 'A program this kubeconfig runs to sign in is not installed.',
  kube_error: 'Kubernetes could not complete the request.',
}

const kit = defineTypedError<KubeErrorCode>('KubeError', FRIENDLY)

export const KubeError = kit.DomainError
export type KubeError = TypedDomainError<KubeErrorCode>
export const toErrorInfo = kit.toErrorInfo
const rawOf = kit.rawOf

/**
 * Collapse an arbitrary Kubernetes client error into a typed {@link KubeError}.
 * Pure + exported so the parser tests can pin the classification.
 */
export function mapKubeError(err: unknown): KubeError {
  if (err instanceof KubeError) return err
  const apiError =
    err && typeof err === 'object'
      ? (err as {
          statusCode?: unknown
          code?: unknown
          body?: unknown
        })
      : undefined
  const statusCode =
    typeof apiError?.statusCode === 'number'
      ? apiError.statusCode
      : typeof apiError?.code === 'number'
        ? apiError.code
        : undefined
  const body =
    apiError?.body && typeof apiError.body === 'object'
      ? (apiError.body as Record<string, unknown>)
      : undefined
  const apiMessage =
    typeof body?.message === 'string'
      ? body.message
      : typeof apiError?.body === 'string'
        ? apiError.body
        : undefined
  const structural = structuralCode(err, body)
  if (structural)
    return new KubeError(structural, apiMessage ?? (rawOf(err) || undefined), { cause: err })
  if (statusCode === 401) {
    return new KubeError('authentication_failed', apiMessage, { cause: err })
  }
  if (statusCode === 403) {
    return new KubeError('permission_denied', apiMessage, { cause: err })
  }
  if (statusCode === 404) {
    return new KubeError('not_found', apiMessage, { cause: err })
  }
  if (statusCode === 408 || statusCode === 504) {
    return new KubeError('command_timeout', apiMessage, { cause: err })
  }
  const raw = apiMessage ?? rawOf(err)
  const low = raw.toLowerCase()
  if (
    low.includes('no configuration has been provided') ||
    low.includes('error loading config file') ||
    (low.includes('config file') && low.includes('does not exist')) ||
    (low.includes('no such file or directory') && low.includes('kube')) ||
    low.includes('invalidconfiguration')
  ) {
    return new KubeError('no_kubeconfig', raw || undefined, { cause: err })
  }
  if (
    low.includes('no context exists with the name') ||
    (low.includes('context') && low.includes('does not exist')) ||
    low.includes('current-context is not set')
  ) {
    return new KubeError('invalid_context', raw || undefined, { cause: err })
  }
  // The kubeconfig `exec`s a credential helper that is not on this machine. It used to be filed as
  // `authentication_failed` (because "executable" contains "exec"), which sent people to refresh
  // credentials they had no program to refresh with. Name the program, and where to get it.
  const helper = isMissingExecutable(err) ? credentialHelperPrerequisite(raw) : null
  if (helper) {
    return new KubeError('tool_missing', raw || undefined, { cause: err, prerequisite: helper })
  }
  // Credential plugins commonly finish with a generic "Unable to connect" line.
  // Classify their actionable root cause first so the UI does not misreport an
  // expired cloud login as a network outage.
  if (
    low.includes('getting credentials') ||
    low.includes('credential plugin') ||
    low.includes('auth plugin') ||
    (low.includes('enoent') && low.includes('spawnsync')) ||
    (low.includes('executable not found') && low.includes('exec')) ||
    low.includes('invalid_grant') ||
    low.includes('gcloud auth login') ||
    low.includes('you must be logged in to the server') ||
    low.includes('the server has asked for the client to provide credentials')
  ) {
    return new KubeError('authentication_failed', raw || undefined, { cause: err })
  }
  if (
    low.includes('forbidden') ||
    low.includes('permission denied') ||
    low.includes('cannot list resource') ||
    low.includes('cannot get resource') ||
    low.includes('cannot create resource') ||
    low.includes('cannot delete resource') ||
    low.includes('cannot patch resource') ||
    low.includes('cannot update resource')
  ) {
    return new KubeError('permission_denied', raw || undefined, { cause: err })
  }
  if (
    low.includes('x509:') ||
    low.includes('self signed certificate') ||
    low.includes('self-signed certificate') ||
    low.includes('certificate signed by unknown authority') ||
    low.includes('certificate has expired') ||
    low.includes('failed to verify certificate') ||
    low.includes('unable to verify the first certificate') ||
    low.includes('unable_to_verify_leaf_signature')
  ) {
    return new KubeError('certificate_error', raw || undefined, { cause: err })
  }
  if (low.includes('kubernetes api timed out after') || low.includes('request timed out')) {
    return new KubeError('command_timeout', raw || undefined, { cause: err })
  }
  if (
    low.includes('unable to connect to the server') ||
    low.includes('unable to connect') ||
    low.includes('is the computer able to access the url') ||
    low.includes('connection refused') ||
    low.includes('econnrefused') ||
    low.includes('enotfound') ||
    low.includes('eai_again') ||
    low.includes('fetch failed') ||
    low.includes('socket hang up') ||
    low.includes('dial tcp') ||
    low.includes('i/o timeout') ||
    low.includes('no route to host') ||
    low.includes('context deadline exceeded') ||
    low.includes('tls handshake timeout')
  ) {
    return new KubeError('context_unreachable', raw || undefined, { cause: err })
  }
  if (
    low.includes('notfound') ||
    low.includes('not found') ||
    low.includes("doesn't have a resource")
  ) {
    return new KubeError('not_found', raw || undefined, { cause: err })
  }
  return new KubeError('kube_error', raw || undefined, { cause: err })
}

/** `metav1.Status.reason` values that name the failure without reading its message. */
const STATUS_REASONS: Record<string, KubeErrorCode> = {
  Unauthorized: 'authentication_failed',
  Forbidden: 'permission_denied',
  NotFound: 'not_found',
  Timeout: 'command_timeout',
}

/** Node's system/TLS error codes for a cluster that never answered. */
const SYSTEM_CODES: Record<string, KubeErrorCode> = {
  ECONNREFUSED: 'context_unreachable',
  ENOTFOUND: 'context_unreachable',
  EAI_AGAIN: 'context_unreachable',
  ECONNRESET: 'context_unreachable',
  EHOSTUNREACH: 'context_unreachable',
  ENETUNREACH: 'context_unreachable',
  ETIMEDOUT: 'context_unreachable',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificate_error',
  SELF_SIGNED_CERT_IN_CHAIN: 'certificate_error',
  CERT_HAS_EXPIRED: 'certificate_error',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificate_error',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'certificate_error',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificate_error',
}

/**
 * The typed signals a failure already carries — the API server's `Status.reason`, or the system
 * error code on the error or its cause — checked before any message wording. Kubectl and
 * credential-mini-app output has no such fields, so the text rules remain the fallback for it.
 */
function structuralCode(
  err: unknown,
  body: Record<string, unknown> | undefined,
): KubeErrorCode | undefined {
  if (body?.kind === 'Status' && typeof body.reason === 'string') {
    const byReason = STATUS_REASONS[body.reason]
    if (byReason) return byReason
  }
  for (let current = err, depth = 0; current && depth < 3; depth++) {
    if (typeof current !== 'object') break
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && SYSTEM_CODES[code]) return SYSTEM_CODES[code]
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}
