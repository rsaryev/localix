/** Defensive ceiling for a misbehaving resource-list pagination stream. */
const MCP_RESOURCE_LIST_MAX_PAGES = 100

/** Bound aggregate allocations even when a server emits very large pages. */
const MCP_RESOURCE_LIST_MAX_ITEMS = 10_000

export async function collectResourcePages<T>(args: {
  serverName: string
  operation: 'resources/list' | 'resources/templates/list'
  listPage(cursor: string | undefined): Promise<{ items: T[]; nextCursor?: string }>
}): Promise<T[]> {
  const collected: T[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MCP_RESOURCE_LIST_MAX_PAGES; page++) {
    const listed = await args.listPage(cursor)
    if (collected.length + listed.items.length > MCP_RESOURCE_LIST_MAX_ITEMS) {
      throw new Error(
        `MCP server "${args.serverName}" exceeded ${MCP_RESOURCE_LIST_MAX_ITEMS} ${args.operation} items`,
      )
    }
    collected.push(...listed.items)

    const nextCursor = listed.nextCursor
    if (nextCursor === undefined) return collected
    if (seenCursors.has(nextCursor)) {
      throw new Error(
        `MCP server "${args.serverName}" returned a duplicate ${args.operation} cursor`,
      )
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new Error(
    `MCP server "${args.serverName}" exceeded ${MCP_RESOURCE_LIST_MAX_PAGES} ${args.operation} pages`,
  )
}
