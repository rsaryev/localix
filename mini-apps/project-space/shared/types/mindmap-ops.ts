import type { MindNode } from './mindmap-text'

/** Tree-only rules. Selection, positioning, history and persistence belong to the outer board. */
export function mindBranch(nodes: readonly MindNode[], id: string): Set<string> {
  const branch = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    for (const node of nodes)
      if (node.parent && branch.has(node.parent) && !branch.has(node.id)) {
        branch.add(node.id)
        changed = true
      }
  }
  return branch
}

export function addMindNode(nodes: readonly MindNode[], parent: string): MindNode[] | null {
  if (nodes.length >= 200 || !nodes.some((node) => node.id === parent)) return null
  const ids = new Set(nodes.map((node) => node.id))
  let number = nodes.length + 1
  while (ids.has(`idea${number}`)) number++
  return [...nodes, { id: `idea${number}`, text: 'New idea', parent }]
}

export function removeMindBranch(nodes: readonly MindNode[], id: string): MindNode[] | null {
  if (!nodes.find((node) => node.id === id)?.parent) return null
  const branch = mindBranch(nodes, id)
  return nodes.filter((node) => !branch.has(node.id))
}

export function moveMindBranch(
  nodes: readonly MindNode[],
  id: string,
  parent: string,
): MindNode[] | null {
  const node = nodes.find((node) => node.id === id)
  if (
    !node?.parent ||
    node.parent === parent ||
    !nodes.some((item) => item.id === parent) ||
    mindBranch(nodes, id).has(parent)
  )
    return null
  return nodes.map((item) => (item.id === id ? { ...item, parent } : item))
}
