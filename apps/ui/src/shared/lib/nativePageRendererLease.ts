const leases = new Map<string, { lease: string; active: boolean }>()
const retired = new Set<string>()
let generation = 0
function newLease(): string {
  generation = Math.max(generation + 1, Date.now() * 1000)
  return `${generation}-${crypto.randomUUID()}`
}

/** A renderer's lifetime differs from the logical page: eviction hides it; closing retires it. */
export const nativePageRendererLease = {
  claim(tabId: string): string {
    const lease = newLease()
    retired.delete(tabId)
    leases.set(tabId, { lease, active: true })
    return lease
  },
  current(tabId: string, lease: string): boolean {
    const current = leases.get(tabId)
    return current?.lease === lease && current.active
  },
  release(tabId: string, lease: string): void {
    const current = leases.get(tabId)
    if (current?.lease === lease) current.active = false
  },
  last: (tabId: string): string | undefined => leases.get(tabId)?.lease,
  retire(tabId: string): { lease: string } | null {
    if (retired.has(tabId)) return null
    retired.add(tabId)
    const lease = leases.get(tabId)?.lease ?? newLease()
    leases.delete(tabId)
    return { lease }
  },
  forget: (tabId: string): void => {
    leases.delete(tabId)
    retired.delete(tabId)
  },
}
