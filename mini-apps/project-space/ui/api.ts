import {
  miniAppApiFetch,
  miniAppApiUrl,
  unwrapMiniAppResponse,
} from '@localixai/mini-app-sdk/ui/transport'
import type { AppliedView, FileText, FolderListing, SpaceView, SteppedView } from '../shared/api'
import type { CameraReport } from '../shared/camera'
import type { SpaceOp } from '../shared/ops/contract'
import { ROUTE_PATH } from '../shared/resource'
import { readSpace, writeSpace } from './spaceUpdates'

/**
 * The board's routes, typed. Every call names the chat the tab belongs to: the host resolves the
 * chat to its project, and the project to its board — so a tab kept open while the person
 * switched chats keeps talking to its own project's board, never the active one.
 */
const route = (sessionId: string, path: string, query: Record<string, string> = {}) => {
  const params = new URLSearchParams({ sessionId, ...query })
  return `${ROUTE_PATH}${path}?${params.toString()}`
}

const read = async <T>(
  sessionId: string,
  path: string,
  init?: RequestInit,
  query?: Record<string, string>,
) => {
  const signal = init?.signal ?? AbortSignal.timeout(init?.method === 'POST' ? 30_000 : 15_000)
  try {
    return await unwrapMiniAppResponse<T>(
      await miniAppApiFetch(route(sessionId, path, query), { ...init, signal }),
    )
  } catch (error) {
    if (signal.aborted && signal.reason?.name === 'TimeoutError')
      throw new Error('The board took too long to answer. Check the board before trying again.')
    throw error
  }
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined
    ? {}
    : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
})

export const spaceApi = {
  space: (sessionId: string) => readSpace(sessionId, () => read<SpaceView>(sessionId, '/space')),
  apply: (sessionId: string, ops: readonly SpaceOp[]) =>
    writeSpace(sessionId, () => read<AppliedView>(sessionId, '/ops', post({ ops }))),
  undo: (sessionId: string) =>
    writeSpace(sessionId, () => read<SteppedView>(sessionId, '/undo', post())),
  redo: (sessionId: string) =>
    writeSpace(sessionId, () => read<SteppedView>(sessionId, '/redo', post())),
  /** Keep a pasted file beside the board; answers the reference to put on it. */
  keepFile: async (sessionId: string, file: Blob, name: string) =>
    (
      await read<{ path: string }>(
        sessionId,
        '/files',
        {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        },
        { name },
      )
    ).path,
  text: (sessionId: string, path: string) =>
    read<FileText>(sessionId, '/text', undefined, { path }),
  folder: (sessionId: string, path: string) =>
    read<FolderListing>(sessionId, '/folder', undefined, { path }),
  /** What the board shows after the agent's camera move `report.seq` (`useCameraBridge`). */
  cameraReport: (sessionId: string, report: CameraReport) =>
    read<{ ok: true }>(sessionId, '/camera/report', post(report)),
  /** A URL an `<img>` or an `<iframe>` can load a referenced file from. */
  rawUrl: (sessionId: string, path: string, revision = '') =>
    miniAppApiUrl(route(sessionId, '/raw', { path, ...(revision ? { v: revision } : {}) })),
}
