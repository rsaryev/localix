import { describe, expect, test } from 'bun:test'
import { isFlowText, readFlow, writeFlow, type FlowContent } from './flow-text'

const read = (text: string) => {
  const flow = readFlow(text)
  if (typeof flow === 'string') throw new Error(flow)
  return flow
}

describe('reading a Mermaid flowchart', () => {
  test('nodes take their shape from their brackets and their role from their class', () => {
    const flow = read(
      [
        'flowchart LR',
        '  A[Plain] --> B(Rounded) --> C([Stadium])',
        '  D[[Sub]] --- E[(Store)]:::store',
        '  F((Circle)) & G{Decide} -.-> H{{Hex}}',
        '  I[/Input/] ==> J>Flag]',
        '  class A,J focal',
      ].join('\n'),
    )
    expect(flow.direction).toBe('LR')
    expect(Object.fromEntries(flow.nodes.map((node) => [node.id, node.shape]))).toEqual({
      A: 'rect',
      B: 'rounded',
      C: 'stadium',
      D: 'subroutine',
      E: 'cylinder',
      F: 'circle',
      G: 'diamond',
      H: 'hexagon',
      I: 'parallelogram',
      J: 'rect',
    })
    expect(flow.nodes.filter((node) => node.role).map((node) => [node.id, node.role])).toEqual([
      ['A', 'focal'],
      ['E', 'store'],
      ['J', 'focal'],
    ])
    expect(
      flow.edges.map((edge) => `${edge.from}${edge.line[0]}${edge.head[0]}${edge.to}`),
    ).toEqual(['AsaB', 'BsaC', 'DsnE', 'FdaH', 'GdaH', 'ItaJ'])
  })

  test('labels in either spelling, quoted text and line breaks', () => {
    const flow = read(
      [
        'graph TD',
        '  A["Sign in<br/>OAuth (PKCE)"] -->|token| B',
        '  B -- on 401 --> A',
        '  B <-->|"a | b"| C',
        '  C -. later .-> A; C == ship ==> D',
      ].join('\n'),
    )
    expect(flow.direction).toBe('TB')
    expect(flow.nodes[0]?.label).toBe('Sign in\nOAuth (PKCE)')
    expect(flow.edges.map((edge) => [edge.label, edge.line, edge.head])).toEqual([
      ['token', 'solid', 'arrow'],
      ['on 401', 'solid', 'arrow'],
      ['a | b', 'solid', 'both'],
      ['later', 'dotted', 'arrow'],
      ['ship', 'thick', 'arrow'],
    ])
  })

  test('subgraphs group what they hold; styling lines are not content', () => {
    const flow = read(
      [
        'flowchart TB',
        '  %% the edge',
        '  classDef hot fill:#f00',
        '  subgraph api [API layer]',
        '    direction LR',
        '    R[Router] --> S[Service]',
        '  end',
        '  subgraph Workers',
        '    Q[Queue]',
        '  end',
        '  S --> Q',
        '  style S fill:#fff',
        '  click S "https://example.com"',
      ].join('\n'),
    )
    expect(flow.groups).toEqual([
      { id: 'api', label: 'API layer' },
      { id: 'Workers', label: 'Workers' },
    ])
    expect(flow.nodes.map((node) => [node.id, node.group])).toEqual([
      ['R', 'api'],
      ['S', 'api'],
      ['Q', 'Workers'],
    ])
  })

  test('what the board cannot draw is refused, never dropped', () => {
    expect(readFlow('sequenceDiagram\nA->>B: hi')).toContain('flowchart TB')
    expect(readFlow('flowchart LR\n  A --> B\n  A --x--> ??')).toMatch(/^line 3/u)
    expect(readFlow('flowchart LR\n  subgraph one\n  A')).toContain('no "end"')
    expect(readFlow('flowchart LR\n  end')).toContain('closes no subgraph')
    expect(
      readFlow('flowchart LR\n  subgraph outer\n  subgraph inner\n  A\n  end\n  end'),
    ).toContain('inside another')
    expect(isFlowText('```mermaid\nflowchart LR\nA-->B\n```')).toBe(true)
    expect(isFlowText('graph')).toBe(true)
    expect(isFlowText('a graph of sales')).toBe(false)
  })
})

describe('writing it back', () => {
  test('a written flow reads back as the same flow', () => {
    const flow: FlowContent = {
      direction: 'RL',
      groups: [{ id: 'core', label: 'Core: data' }],
      nodes: [
        { id: 'web', label: 'Web UI', shape: 'rounded', role: 'focal' },
        { id: 'api', label: 'API\nhono:5151', shape: 'rect', group: 'core' },
        { id: 'db', label: 'db', shape: 'cylinder', role: 'store', group: 'core' },
        { id: 'ok', label: 'ok?', shape: 'diamond' },
      ],
      edges: [
        { from: 'web', to: 'api', label: 'HTTPS', line: 'solid', head: 'arrow' },
        { from: 'api', to: 'db', label: 'reads "rows"', line: 'dotted', head: 'both' },
        { from: 'api', to: 'ok', label: '', line: 'thick', head: 'none' },
      ],
    }
    const text = writeFlow(flow)
    expect(text.split('\n')[0]).toBe('flowchart RL')
    expect(read(text)).toEqual({
      ...flow,
      // Grouped nodes are written inside their subgraph, so they come first when read back.
      nodes: [flow.nodes[1]!, flow.nodes[2]!, flow.nodes[0]!, flow.nodes[3]!],
    })
  })
})
