export interface MindNode {
  id: string
  text: string
  parent?: string
}

/** Native subset of Mermaid mindmap: indentation and labelled nodes, without external styling. */
export function readMindmap(text: string): { nodes: MindNode[] } | string {
  const lines = text
    .trim()
    .replace(/^```(?:mermaid)?\s*\n|\n```$/gu, '')
    .split(/\r?\n/u)
  if (lines.shift()?.trim() !== 'mindmap')
    return 'Start with mindmap, then indent each branch below its parent.'
  const nodes: MindNode[] = []
  const stack: { indent: number; id: string }[] = []
  for (const raw of lines) {
    const label = raw.trim()
    if (!label || label.startsWith('%%')) continue
    if (label.startsWith('::'))
      return 'Icons and custom classes are not supported in native mind maps.'
    const indent = raw.match(/^\s*/u)![0].replaceAll('\t', '  ').length
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    if (nodes.length && !stack.length)
      return 'A mind map must have one root. Indent the remaining nodes below it.'
    const shaped = /^([A-Za-z][\w-]*)\s*(?:\[([\s\S]*)\]|\(\(([\s\S]*)\)\)|\(([\s\S]*)\))$/u.exec(
      label,
    )
    let value = shaped?.[2] ?? shaped?.[3] ?? shaped?.[4] ?? label
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string
      } catch {
        return 'A quoted node label is not valid JSON.'
      }
    }
    const id = shaped?.[1] ?? `node${nodes.length + 1}`
    if (typeof value !== 'string' || !value.trim()) return 'Every node needs a text label.'
    if (nodes.some((node) => node.id === id)) return `The node id ${id} is repeated.`
    const parent = stack.at(-1)?.id
    nodes.push({ id, text: value, ...(parent ? { parent } : {}) })
    stack.push({ indent, id })
    if (nodes.length > 200) return 'A mind map can have at most 200 nodes.'
  }
  return nodes.length ? { nodes } : 'Add a root node below mindmap.'
}

export function writeMindmap(value: { nodes: MindNode[] }): string {
  const children = new Map<string | undefined, MindNode[]>()
  for (const node of value.nodes)
    children.set(node.parent, [...(children.get(node.parent) ?? []), node])
  const lines = ['mindmap']
  const walk = (parent: string | undefined, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      lines.push(`${'  '.repeat(depth + 1)}${node.id}[${JSON.stringify(node.text)}]`)
      walk(node.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return lines.join('\n')
}
