import type {
  MessageBinding,
  MessageMutationResponse,
  SessionBranchTree,
  UiSession,
} from '../contracts'
import { toUiSession } from '../converters'
import { eventSocket } from '../eventSocket'
import { client, unwrap } from '../internal'
import {
  readyWorkbenchToolSurface,
  readyWorkbenchToolSurfaceForProject,
} from '@/shared/contrib/uiLocationCatalogSync'
import { agentRunPreflight } from '../agentRunPreflight'

/** Keep the realtime send response tied to the HTTP/API owner contract, including
 * the `queued` acceptance signal used to reconcile optimistic placeholders. */
export type SendMessageResult = MessageMutationResponse

async function readyAgentRunToolSurface(projectId?: string | null) {
  const policy = agentRunPreflight(projectId)
  const surface =
    projectId === undefined
      ? readyWorkbenchToolSurface()
      : readyWorkbenchToolSurfaceForProject(projectId)
  if (!policy) return surface
  const [, readySurface] = await Promise.all([policy, surface])
  return readySurface
}

/** Turns and messages: send, regenerate, edit, reactions, pins and branches. */
export const messagesApi = {
  // Rides the shared realtime WebSocket (see eventSocket) so a send never competes
  // for one of the browser's scarce HTTP connection slots while streams are open.
  async sendMessage(
    sessionId: string,
    prompt: string,
    bindings?: MessageBinding[],
    /** Hide the user turn in the transcript (the model still sees it) — for machine-composed
     *  prompts the user triggered but did not type (e.g. the chart's analysis wizard). */
    isInternal?: boolean,
    /** Optimistic user-row identity for exact server-queue reconciliation. */
    clientMessageId?: string,
    /** Owning session scope. A warm/mini app surface can send outside the active
     * route, so its run must never inherit another project's UI catalog. */
    projectId?: string | null,
  ): Promise<SendMessageResult> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return eventSocket.request<SendMessageResult>({
      t: 'send',
      sessionId,
      prompt,
      toolSurface,
      ...(bindings && bindings.length > 0 ? { bindings } : {}),
      ...(isInternal ? { isInternal: true } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
    })
  },

  /**
   * Regenerate the latest reply. `expectedMessageId` names the reply the caller means (a Retry
   * from a failure row); the server refuses with 409 `regenerate_superseded` / `regenerate_no_reply`
   * when it is not the latest, instead of rewriting whatever reply came after it.
   */
  async regenerate(
    sessionId: string,
    projectId?: string | null,
    expectedMessageId?: string,
  ): Promise<SendMessageResult> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return unwrap(
      await client.rpc.sessions[':id'].regenerate.$post({
        param: { id: sessionId },
        json: { toolSurface, ...(expectedMessageId ? { expectedMessageId } : {}) },
      }),
    )
  },

  async rollback(sessionId: string, messageId: string): Promise<{ restoredPrompt: string }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].rollback.$post({
        param: { id: sessionId, messageId },
      }),
    )
  },

  /**
   * Toggle your own mark on a message. The server answers whether it is now on, but the chip
   * does not wait for that: the updated message arrives on the stream like any other change,
   * so both the person's marks and an agent's reach every open client the same way.
   */
  async reactToMessage(
    sessionId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: true; reacted: boolean }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].reactions.$post({
        param: { id: sessionId, messageId },
        json: { emoji },
      }),
    )
  },

  /**
   * Keep a message in the agent's view across context checkpoints, or stop keeping it. Like a
   * reaction, the pinned mark arrives on the stream as the updated message.
   */
  async pinMessage(
    sessionId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<{ ok: true; pinned: boolean }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].pin.$post({
        param: { id: sessionId, messageId },
        json: { pinned },
      }),
    )
  },

  async switchBranch(
    sessionId: string,
    messageId: string,
    branchIndex: number,
  ): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].messages[':messageId']['switch-branch'].$post({
        param: { id: sessionId, messageId },
        json: { branchIndex },
      }),
    )
    return toUiSession(json)
  },

  /** Full message tree (all branches) + active path for the branch-tree panel. */
  async getBranchTree(sessionId: string): Promise<SessionBranchTree> {
    return unwrap(
      await client.rpc.sessions[':id'].branches.$get({
        param: { id: sessionId },
      }),
    )
  },

  /** Jump the active branch to any message in the tree (leaf moves to its deepest descendant). */
  async checkoutBranch(sessionId: string, messageId: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].branches.checkout.$post({
        param: { id: sessionId },
        json: { messageId },
      }),
    )
    return toUiSession(json)
  },

  /** Fork the conversation into a NEW session (history up to messageId, or the current leaf). */
  async forkSession(sessionId: string, messageId?: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].fork.$post({
        param: { id: sessionId },
        json: messageId ? { messageId } : {},
      }),
    )
    return toUiSession(json)
  },

  /** Open (or reopen) the side-conversation thread anchored to an assistant message. */
  async openMessageThread(sessionId: string, messageId: string): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].thread.$post({
        param: { id: sessionId, messageId },
      }),
    )
    return toUiSession(json)
  },

  /** Edit a past user message → forks a new branch and re-runs from there. */
  async editMessage(
    sessionId: string,
    messageId: string,
    content: string,
    projectId?: string | null,
  ): Promise<{ sessionId: string; messageId: string }> {
    const toolSurface = await readyAgentRunToolSurface(projectId)
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].edit.$post({
        param: { id: sessionId, messageId },
        json: { content, toolSurface },
      }),
    )
  },

  /** Tick or clear one box of a reply's checklist; the stored marks arrive as the updated message. */
  async checkMessageTask(
    sessionId: string,
    messageId: string,
    key: string,
    checked: boolean,
  ): Promise<{ ok: true; checked: boolean }> {
    return unwrap(
      await client.rpc.sessions[':id'].messages[':messageId'].tasks.$post({
        param: { id: sessionId, messageId },
        json: { key, checked },
      }),
    )
  },
  /**
   * Ask for the automatic session recap after a break. The server decides whether one is due; a
   * written recap arrives as a transcript row over the session stream, so only the verdict returns.
   */
  async requestSessionRecap(sessionId: string): Promise<{ status: string }> {
    return unwrap(await client.rpc.sessions[':id'].recap.$post({ param: { id: sessionId } }))
  },
}
