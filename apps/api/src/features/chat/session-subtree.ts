/** Enumerate a complete tree before mutation, with every descendant preceding its parent. */
export async function sessionSubtreeForDeletion(
  rootId: string,
  listChildren: (sessionId: string) => Promise<readonly string[]>,
): Promise<string[]> {
  const ids = [rootId]
  const seen = new Set(ids)
  for (let index = 0; index < ids.length; index += 1) {
    for (const child of await listChildren(ids[index]!)) {
      if (seen.has(child)) throw new Error(`Invalid session tree: repeated identity ${child}`)
      seen.add(child)
      ids.push(child)
    }
  }
  return ids.reverse()
}
