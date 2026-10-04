export interface ChatScrollSnapshot {
  scrollTop: number
  follow: boolean
  /** TanStack Virtual's measured row geometry. Paired with scrollTop so an
   * evicted/remounted chat restores the same pixels instead of starting from
   * estimates and shifting as rows are measured again. */
  measurements?: ChatVirtualMeasurement[]
  /** Container width the `measurements` were taken at. A chat row's height is a
   * function of its wrap width, so geometry measured at another width is not
   * geometry — replaying it is the settle/jump when a session is reopened in a
   * differently sized pane. The cached height is skipped unless this width
   * equals the current render width. */
  measurementWidth?: number
}

export interface ChatVirtualMeasurement {
  index: number
  key: string | number | bigint
  start: number
  size: number
  end: number
  lane: number
}

const MAX_SESSION_SNAPSHOTS = 64
export const MAX_MEASUREMENT_SNAPSHOTS = 8
export const MAX_MEASUREMENTS_PER_SESSION = 20_000
const snapshots = new Map<string, ChatScrollSnapshot>()
// MessageList and its parent auto-scroll hook unmount independently. Keep row
// geometry here too so cleanup order cannot make an otherwise valid virtualizer
// snapshot disappear before the parent writes scrollTop/follow.
const pendingMeasurements = new Map<string, { rows: ChatVirtualMeasurement[]; width: number }>()
const measurementSessions = new Map<string, true>()

function clearMeasurements(sessionId: string): void {
  pendingMeasurements.delete(sessionId)
  measurementSessions.delete(sessionId)
  const snapshot = snapshots.get(sessionId)
  if (!snapshot?.measurements) return
  const { measurements: _measurements, measurementWidth: _width, ...positionOnly } = snapshot
  snapshots.set(sessionId, positionOnly)
}

function touchMeasurementSession(sessionId: string): void {
  measurementSessions.delete(sessionId)
  measurementSessions.set(sessionId, true)
  while (measurementSessions.size > MAX_MEASUREMENT_SNAPSHOTS) {
    const oldest = measurementSessions.keys().next().value
    if (oldest === undefined) break
    clearMeasurements(oldest)
  }
}

export function hasChatScrollSnapshot(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && snapshots.has(sessionId))
}

export function getChatScrollSnapshot(
  sessionId: string | null | undefined,
): ChatScrollSnapshot | null {
  if (!sessionId) return null
  const snapshot = snapshots.get(sessionId)
  if (!snapshot) return null
  snapshots.delete(sessionId)
  snapshots.set(sessionId, snapshot)
  return snapshot
}

export function saveChatScrollSnapshot(sessionId: string, snapshot: ChatScrollSnapshot): void {
  const previous = snapshots.get(sessionId)
  const pending = pendingMeasurements.get(sessionId)
  // Width travels with the rows it belongs to — never pair rows from one source
  // with a width from another, or the guard would validate the wrong geometry.
  const geometry = snapshot.measurements
    ? { rows: snapshot.measurements, width: snapshot.measurementWidth }
    : previous?.measurements
      ? { rows: previous.measurements, width: previous.measurementWidth }
      : pending
        ? { rows: pending.rows, width: pending.width }
        : null
  snapshots.delete(sessionId)
  snapshots.set(sessionId, {
    scrollTop: Math.max(0, Number.isFinite(snapshot.scrollTop) ? snapshot.scrollTop : 0),
    follow: snapshot.follow,
    measurements: geometry?.rows,
    measurementWidth: geometry?.width,
  })
  if (geometry) {
    pendingMeasurements.delete(sessionId)
    touchMeasurementSession(sessionId)
  }
  while (snapshots.size > MAX_SESSION_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value
    if (oldest === undefined) break
    snapshots.delete(oldest)
    clearMeasurements(oldest)
  }
}

export function saveChatVirtualMeasurements(
  sessionId: string,
  measurements: ChatVirtualMeasurement[],
  width: number,
): void {
  // Unmeasurable width (a detached or never-laid-out viewport) makes the rows
  // unverifiable later, and unverifiable geometry is exactly what replays as a
  // jump. Drop them rather than keep a cache no one can validate.
  if (measurements.length > MAX_MEASUREMENTS_PER_SESSION || !(width > 0)) {
    clearMeasurements(sessionId)
    return
  }
  const snapshot = snapshots.get(sessionId)
  if (snapshot) {
    saveChatScrollSnapshot(sessionId, { ...snapshot, measurements, measurementWidth: width })
    return
  }
  pendingMeasurements.delete(sessionId)
  pendingMeasurements.set(sessionId, { rows: measurements, width })
  touchMeasurementSession(sessionId)
}

/**
 * The width guard, in one predicate: a cached dynamic height is
 * only valid at the width it was measured at. `width <= 0` means "not observable yet" — a viewport that
 * has not been laid out (first render, hidden warm tab) proves nothing, so the
 * cache survives until a real width can judge it.
 */
export function measurementsUsableAtWidth(
  measurementWidth: number | undefined,
  width: number,
): boolean {
  if (!measurementWidth) return false
  if (!Number.isFinite(width) || width <= 0) return true
  return measurementWidth === width
}

/** Row geometry from `snapshot`, or undefined when it was measured elsewhere. */
export function chatMeasurementsForWidth(
  snapshot: ChatScrollSnapshot | null | undefined,
  width: number,
): ChatVirtualMeasurement[] | undefined {
  if (!snapshot?.measurements) return undefined
  return measurementsUsableAtWidth(snapshot.measurementWidth, width)
    ? snapshot.measurements
    : undefined
}

export function isUsableScrollViewport(node: Pick<HTMLElement, 'clientHeight'>): boolean {
  return node.clientHeight > 0
}

export function restoredScrollTop(
  snapshot: ChatScrollSnapshot,
  geometry: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>,
): number {
  return snapshot.follow
    ? Math.max(0, geometry.scrollHeight - geometry.clientHeight)
    : Math.min(snapshot.scrollTop, Math.max(0, geometry.scrollHeight - geometry.clientHeight))
}

export function clearChatScrollSnapshotsForTests(): void {
  snapshots.clear()
  pendingMeasurements.clear()
  measurementSessions.clear()
}
