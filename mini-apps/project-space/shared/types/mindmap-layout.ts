import type { MindNode } from './mindmap-text'

/** Same deterministic tree geometry on the server, the board and its placement preview. */
export function layoutMindmap(nodes: readonly MindNode[]) {
  const children = new Map<string | undefined, MindNode[]>()
  for (const node of nodes) children.set(node.parent, [...(children.get(node.parent) ?? []), node])
  const gap = 18,
    width = 180,
    pad = 24,
    column = 240
  const heights = new Map(
    nodes.map((node) => [
      node.id,
      Math.max(42, Math.min(8, Math.ceil(node.text.length / 24)) * 16 + 20),
    ]),
  )
  const spans = new Map<string, number>()
  const span = (node: MindNode): number => {
    const branches = children.get(node.id) ?? []
    const size = Math.max(
      heights.get(node.id)!,
      branches.reduce((sum, child) => sum + span(child), 0) +
        Math.max(0, branches.length - 1) * gap,
    )
    spans.set(node.id, size)
    return size
  }
  const root = children.get(undefined)?.[0]
  if (!root) return { width: 228, height: 120, boxes: [], edges: [] }
  const total = span(root)
  const boxes: { node: MindNode; x: number; y: number; w: number; h: number }[] = []
  const edges: { from: string; to: string }[] = []
  const walk = (node: MindNode, depth: number, top: number) => {
    const h = heights.get(node.id)!,
      size = spans.get(node.id)!
    boxes.push({ node, x: pad + depth * column, y: pad + top + (size - h) / 2, w: width, h })
    const branches = children.get(node.id) ?? []
    const branchHeight =
      branches.reduce((sum, child) => sum + spans.get(child.id)!, 0) +
      Math.max(0, branches.length - 1) * gap
    let at = top + (size - branchHeight) / 2
    for (const child of branches) {
      edges.push({ from: node.id, to: child.id })
      walk(child, depth + 1, at)
      at += spans.get(child.id)! + gap
    }
  }
  walk(root, 0, 0)
  return {
    width: Math.max(...boxes.map((box) => box.x + box.w)) + pad,
    height: Math.max(120, total + pad * 2),
    boxes,
    edges,
  }
}
