export interface ReaderNavigationLocation {
  chapter: number
  fraction: number
  fragment?: string
}

export interface ReaderNavigationTrail {
  past: ReaderNavigationLocation[]
  future: ReaderNavigationLocation[]
}

export function emptyReaderNavigationTrail(): ReaderNavigationTrail {
  return { past: [], future: [] }
}

function normalizeReaderNavigationLocation(
  location: ReaderNavigationLocation,
): ReaderNavigationLocation {
  const fragment = location.fragment?.trim().slice(0, 256)
  return {
    chapter: Math.max(0, Math.floor(location.chapter)),
    fraction: Math.max(0, Math.min(1, location.fraction)),
    ...(fragment ? { fragment } : {}),
  }
}

function sameReaderNavigationLocation(
  left: ReaderNavigationLocation,
  right: ReaderNavigationLocation,
) {
  return (
    left.chapter === right.chapter &&
    left.fragment === right.fragment &&
    Math.abs(left.fraction - right.fraction) < 0.001
  )
}

export function pushReaderNavigation(
  trail: ReaderNavigationTrail,
  origin: ReaderNavigationLocation,
  destination: ReaderNavigationLocation,
  limit = 64,
): ReaderNavigationTrail {
  const normalizedOrigin = normalizeReaderNavigationLocation(origin)
  const normalizedDestination = normalizeReaderNavigationLocation(destination)
  if (sameReaderNavigationLocation(normalizedOrigin, normalizedDestination)) return trail
  return {
    past: [...trail.past, normalizedOrigin].slice(-Math.max(1, limit)),
    future: [],
  }
}

export function moveReaderNavigation(
  trail: ReaderNavigationTrail,
  origin: ReaderNavigationLocation,
  direction: 'back' | 'forward',
): { trail: ReaderNavigationTrail; location: ReaderNavigationLocation | null } {
  const normalizedOrigin = normalizeReaderNavigationLocation(origin)
  if (direction === 'back') {
    const location = trail.past.at(-1)
    if (!location) return { trail, location: null }
    return {
      location,
      trail: {
        past: trail.past.slice(0, -1),
        future: [normalizedOrigin, ...trail.future].slice(0, 64),
      },
    }
  }
  const location = trail.future[0]
  if (!location) return { trail, location: null }
  return {
    location,
    trail: {
      past: [...trail.past, normalizedOrigin].slice(-64),
      future: trail.future.slice(1),
    },
  }
}
