import type { Message, UiSession } from '@/shared/api/contracts'
import { remapMessageAnchors } from '@/shared/api/messageAnchorRemap'

/**
 * Merge a fresh whole-session body over the copy already in the store WITHOUT
 * wiping in-flight client state. Every whole-body replace path (`_replaceSession`
 * fed by reconcile, `hydrateWorkspace` refetches, `selectSession`) races the send:
 * the backend body knows nothing about
 *
 *   (a) client-only system notices (key switch, model change, …),
 *   (b) optimistic placeholder rows painted on Enter that no echo has claimed yet
 *       (the reconcile watchdog fires EXACTLY during a long prefill), and
 *   (c) `streamingMessageId` / `activePhase` — SSE-only fields the wire
 *       converters never map, so a replace mid-stream blanked the skeleton.
 *
 * Carrying them forward here makes those replaces harmless: the carried rows
 * self-clean through the normal claim/sweep machinery (applyStreamEvent), and
 * the stream target is only kept while a run is live on either side.
 * Pure carry-forward on replace — never touches the claim/sweep logic itself.
 */
export function mergeSessionBody(prev: UiSession | undefined, next: UiSession): UiSession {
  if (!prev) return next

  // A workspace/list SUMMARY is metadata, not a conversation body. Its
  // `messages: []` used to replace an already-loaded transcript during any
  // workspace revalidation; it could also land between the route selecting the
  // summary and the detail RPC, making the first open render the genuine empty
  // greeting. Keep detail-only/live fields from the loaded object and update only
  // metadata the summary actually owns. An explicit marker avoids heuristics based
  // on messageCount (detail responses may intentionally contain a bounded tail).
  if (next.bodyLoaded === false && prev.bodyLoaded !== false) {
    return {
      ...prev,
      id: next.id,
      seq: next.seq,
      title: next.title,
      isPinned: next.isPinned,
      isArchived: next.isArchived,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
      agents: next.agents,
      rosterLocked: next.rosterLocked,
      permissionMode: next.permissionMode,
      isRunning: next.isRunning,
      projectId: next.projectId,
      parentSessionId: next.parentSessionId,
      rootSessionId: next.rootSessionId,
      sessionKind: next.sessionKind,
      runtimeStatus: next.runtimeStatus,
      ...(next.externalAgentProvider !== undefined
        ? { externalAgentProvider: next.externalAgentProvider }
        : {}),
      ...(next.externalAgentSessionKey !== undefined
        ? { externalAgentSessionKey: next.externalAgentSessionKey }
        : {}),
      sourceToolCallId: next.sourceToolCallId,
      pinnedSkills: next.pinnedSkills,
      sessionTiming: next.sessionTiming,
      messageCount: next.messageCount,
      loops: next.loops,
      queuedMessages: next.queuedMessages,
      // A fresher preview when the summary has one; the old one when it does not (a live
      // `session.updated` omits it on purpose). Never `undefined` over a line we already had.
      lastMessage: next.lastMessage ?? prev.lastMessage,
      bodyLoaded: true,
    }
  }

  let merged = next
  // The conversation's plans. A ROOT detail carries them and they REPLACE the stored list — the
  // server is the authority, and a list that had missed a `plan.updated` frame is corrected by the
  // next refetch instead of being carried forever (otherwise the strip offered Approve on a
  // version already approved). Only a body that does not carry them — a child's detail, or one
  // whose plans could not be read — keeps the list it had, since absent means "unknown", not
  // "none"; dropping it then made the strip vanish until a remount.
  if (merged.plans === undefined && prev.plans !== undefined) {
    merged = { ...merged, plans: prev.plans }
  }
  // The conversation's unfinished work follows the same rule: a root detail replaces it, a body
  // that does not carry it keeps what was known.
  if (merged.resumePoints === undefined && prev.resumePoints !== undefined) {
    merged = { ...merged, resumePoints: prev.resumePoints }
  }
  // Language-server diagnostics arrive ONLY through the live `lsp.diagnostics` event; no body
  // carries them (both converters seed `{}`). Taking the body's empty map wiped the Problems panel
  // and every editor squiggle on each replace — the reconnect reconcile, the 15s watchdog, a
  // permission or model change — until the server happened to republish that file. An empty map
  // therefore means "not sent", and the known diagnostics stay; a body that does carry some wins.
  if (
    Object.keys(merged.lspDiagnostics ?? {}).length === 0 &&
    Object.keys(prev.lspDiagnostics ?? {}).length > 0
  ) {
    merged = { ...merged, lspDiagnostics: prev.lspDiagnostics }
  }
  // The sidebar's second line, which opening a session used to delete.
  //
  // A DETAIL body carries no preview — the transcript is right there, so the server does not
  // repeat it — and replacing the loaded object with one dropped the line for good: every
  // later summary omits it too while a run is live, so nothing put it back until a reload.
  // Selecting a chat made its own last message vanish from the list.
  if (!merged.lastMessage && prev.lastMessage) {
    merged = { ...merged, lastMessage: prev.lastMessage }
  }
  // Both converters seed `messages`; tolerate its absence for a session
  // rehydrated from an older shape (same stance as the reducer tests').
  const prevMessages = prev.messages ?? []
  if (!merged.messages) merged = { ...merged, messages: [] }

  // (a) Client-minted notices, which no backend body can contain.
  //
  // This used to key on `role === 'system'` and skip the whole carry-forward when the body
  // held ANY system row. Both halves were wrong: `toUiMessage` projects any persisted row
  // carrying a `systemNotice` or a `commandOutput` to `role: 'system'`, so one persisted
  // `mode_change` (written by the backend on every `/mode` switch) or one slash-command
  // output made the guard permanently false — and from then on EVERY replace silently
  // deleted every client-only notice in that session: "Model changed to …",
  // "Connection switched to …", a hook's warning line. The reconcile watchdog alone fires
  // every 15s while a run is live.
  //
  // Identity is per-row now, so a body row can only suppress the notice it actually is — with one
  // exception that is not about identity at all: a row asserting a terminal is waiting RIGHT NOW is
  // never carried, because `detail.terminalWaits` is the authority on live waits and `toUiSession`
  // re-mints one `terminal-wait-snapshot-<terminalId>` row per wait it still reports. Carrying the
  // client's copy would resurrect a wait the body is positive evidence AGAINST: `terminal.waiting` is
  // live-only, so the settle frame emitted while the socket was down is never replayed, and the stale
  // row then drives the status phase indefinitely.
  //
  // That authority holds only for a DETAIL body. `hydrateWorkspace` merges `toUiSessionSummary`
  // bodies — `messages: []`, no `terminalWaits` — for every session except the active one, so a
  // summary knows nothing about waits and must not be read as denying one. Treating it as authority
  // deleted a background session's only "Waiting for background terminal" record on any workspace
  // reload (a message edit or delete triggers one), with nothing to re-mint it until the user opened
  // that session.
  //
  // Intentional narrowing: a PERSISTED system row that fell out of the body's message
  // window is no longer re-appended at the tail. It has no `afterMessageId`, so it landed
  // at the bottom, below rows that came after it — while the rest of the trimmed
  // conversation stayed absent. Absent is the consistent answer.
  const carriedNotices = prevMessages.filter((m) => m.clientOnly)
  if (carriedNotices.length > 0) {
    const bodyIds = new Set(merged.messages.map((m) => m.id))
    const bodyKnowsWaits = merged.messages.length > 0
    const fresh = carriedNotices.filter(
      (m) =>
        !bodyIds.has(m.id) &&
        !(
          bodyKnowsWaits &&
          m.terminalLifecycle?.kind === 'waiting' &&
          m.terminalLifecycle.active === true
        ),
    )
    if (fresh.length > 0) merged = { ...merged, messages: [...merged.messages, ...fresh] }
  }

  // (b) Un-claimed optimistic rows: keep them at the tail unless the fetched
  // body already contains their real counterpart — a row NEW to the body (not in
  // prev) with the same renderable role is the persisted echo having landed via
  // the fetch instead of the stream (user rows also match on content, so an
  // older user turn can never swallow a fresh placeholder).
  const pendingOptimistic = prevMessages.filter((m) => m.optimistic)
  const prevMessageIds = new Set(prevMessages.map((m) => m.id))
  const claimedIdRemap = new Map<string, string>()
  if (pendingOptimistic.length > 0) {
    const claimedOptimisticIds = new Set<string>()
    const messages = merged.messages.map((message) => {
      if (
        prevMessageIds.has(message.id) ||
        message.optimistic ||
        message.isInternal ||
        message.uiOnly
      ) {
        return message
      }

      const exact = (message.clientMessageIds ?? [])
        .map((id) => pendingOptimistic.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is Message => Boolean(candidate))
      const matched =
        exact.length > 0
          ? exact
          : message.clientMessageIds?.length
            ? []
            : [
                pendingOptimistic.find(
                  (candidate) =>
                    !claimedOptimisticIds.has(candidate.id) &&
                    candidate.role === message.role &&
                    (candidate.role !== 'user' ||
                      (candidate.content ?? '') === (message.content ?? '')),
                ),
              ].filter((candidate): candidate is Message => Boolean(candidate))
      for (const candidate of matched) claimedOptimisticIds.add(candidate.id)
      for (const candidate of matched) {
        if (!claimedIdRemap.has(candidate.id)) claimedIdRemap.set(candidate.id, message.id)
      }
      const first = matched[0]
      return first && !message.renderKey
        ? { ...message, renderKey: first.renderKey ?? first.id }
        : message
    })
    if (messages.some((message, index) => message !== merged.messages[index])) {
      merged = { ...merged, messages }
    }
    const carried = pendingOptimistic.filter((opt) => !claimedOptimisticIds.has(opt.id))
    if (carried.length > 0) merged = { ...merged, messages: [...merged.messages, ...carried] }
    const remappedMessages = remapMessageAnchors(merged.messages, claimedIdRemap)
    if (remappedMessages !== merged.messages) merged = { ...merged, messages: remappedMessages }
  }

  // (c) Keep the live-stream pointers while a run is live on either side (the
  // optimistic isRunning lead means prev can be running before the body says so).
  // If this body claimed the assistant skeleton, move the pointer to the same
  // persisted id; otherwise MessageList sees an authoritative but absent target
  // and drops the real row's streaming visuals until a later SSE frame repairs it.
  if (next.isRunning || prev.isRunning) {
    const streamTarget = next.streamingMessageId ?? prev.streamingMessageId ?? null
    let reconciledStreamTarget = streamTarget
      ? (claimedIdRemap.get(streamTarget) ?? streamTarget)
      : null

    // A steer or a checkpoint-recovery rerun can create another assistant segment before this
    // reconcile reaches the client. In that case the original skeleton is
    // legitimately claimed by the first segment, but the live phase belongs to
    // the final fresh assistant in the running body. An explicit target on
    // `next` remains authoritative.
    if (
      !next.streamingMessageId &&
      next.isRunning &&
      streamTarget &&
      claimedIdRemap.has(streamTarget)
    ) {
      for (const message of next.messages ?? []) {
        if (
          message.role === 'assistant' &&
          !prevMessageIds.has(message.id) &&
          !message.optimistic &&
          !message.isInternal &&
          !message.uiOnly
        ) {
          reconciledStreamTarget = message.id
        }
      }
    }

    // The converters never map a live phase, so the stored one is carried — EXCEPT a terminal
    // wait the detail denies. `toUiSession` derives the wait phase from `detail.terminalWaits`
    // (the authority, see (a)), and the settle frame is live-only: carrying the stored wait over a
    // detail's null kept "Waiting for background terminal" on screen for the rest of the run.
    const carriedPhase =
      next.bodyLoaded === true && prev.activePhase?.id.startsWith('terminal-wait:')
        ? null
        : prev.activePhase
    merged = {
      ...merged,
      streamingMessageId: reconciledStreamTarget,
      activePhase: next.activePhase ?? carriedPhase ?? null,
    }
  }

  return merged
}
