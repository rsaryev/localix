/**
 * `Ports` from the Docker Engine API, rendered the way `docker ps` renders it.
 *
 * Split out of `api-shapes.ts` because it is the one genuinely fiddly mapping: the API
 * gives a structured array while the CLI prints a grouped, sorted display string, and
 * two of its behaviours are not guessable — consecutive private ports collapse into a
 * range, and a published port that DIFFERS from the private one is pulled out of the
 * grouping and appended at the end. Faithful to docker/cli's `DisplayablePorts`.
 */

export interface ApiPort {
  IP?: string
  PrivatePort?: number
  PublicPort?: number
  Type?: string
}

/** `net.JoinHostPort` — brackets an IPv6 literal, leaves IPv4 and names alone. */
function joinHostPort(host: string, port: string): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

function comparePorts(a: ApiPort, b: ApiPort): number {
  const privateA = a.PrivatePort ?? 0
  const privateB = b.PrivatePort ?? 0
  if (privateA !== privateB) return privateA - privateB
  const ipA = a.IP ?? ''
  const ipB = b.IP ?? ''
  if (ipA !== ipB) return ipA < ipB ? -1 : 1
  const publicA = a.PublicPort ?? 0
  const publicB = b.PublicPort ?? 0
  if (publicA !== publicB) return publicA - publicB
  return (a.Type ?? '').localeCompare(b.Type ?? '')
}

function formGroup(key: string, first: number, last: number): string {
  const parts = key.split('/')
  const ip = parts.length > 1 ? parts[0]! : ''
  const type = parts.length > 1 ? parts[1]! : parts[0]!
  const range = first === last ? String(first) : `${first}-${last}`
  // With an IP the group reads as a mapping onto itself: `0.0.0.0:5672->5672/tcp`.
  return `${ip ? `${joinHostPort(ip, range)}->${range}` : range}/${type}`
}

/**
 * Render `Ports` the way `docker ps` does — docker/cli's `DisplayablePorts`.
 *
 * Reimplemented faithfully rather than approximated, because the output is what a user
 * recognises and two behaviours here are not guessable: consecutive private ports collapse
 * into a range (`8000-8005/tcp`), and a published port that DIFFERS from the private one is
 * pulled out of the grouping and appended at the end.
 */
export function formatApiPorts(ports: readonly ApiPort[] | undefined): string {
  if (!ports?.length) return ''
  const sorted = [...ports].sort(comparePorts)
  const groups = new Map<string, { first: number; last: number }>()
  const order: string[] = []
  const result: string[] = []
  const hostMappings: string[] = []

  for (const port of sorted) {
    const current = port.PrivatePort ?? 0
    const type = port.Type ?? 'tcp'
    const ip = port.IP ?? ''
    let key = type
    if (ip) {
      if ((port.PublicPort ?? 0) !== current) {
        // A remapped publication cannot be expressed as a self-mapping group.
        hostMappings.push(`${joinHostPort(ip, String(port.PublicPort ?? 0))}->${current}/${type}`)
        continue
      }
      key = `${ip}/${type}`
    }
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { first: current, last: current })
      order.push(key)
      continue
    }
    if (current === group.last + 1) {
      group.last = current
      continue
    }
    // A gap closes the run; the replacement group is flushed by the tail loop below.
    result.push(formGroup(key, group.first, group.last))
    groups.set(key, { first: current, last: current })
  }

  for (const key of order) {
    const group = groups.get(key)
    if (group) result.push(formGroup(key, group.first, group.last))
  }
  return [...result, ...hostMappings].join(', ')
}
