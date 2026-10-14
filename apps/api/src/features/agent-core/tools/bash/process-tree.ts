/**
 * Host-shim: the process-tree kill lives in `lib/process-tree.ts`, shared with the PTY backend,
 * the login-shell probe and the fatal-exit reaper — four hand-written copies of one ladder had
 * drifted. This file stays as the in-agent-core import path its callers already use.
 */
export { isAlive, killProcessTree, stillRunning } from '../../../../lib/process-tree'
