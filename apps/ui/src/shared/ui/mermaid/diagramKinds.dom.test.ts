import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { DIAGRAM_KINDS } from '@localixai/api/answer-markdown'

let teardown: () => Promise<void>
const previousGlobals = ['fastdom', 'injected'].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
)
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
  // Mermaid's optional diagram chunks publish fastdom globals even when only parsing.
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

// The prompt must not advertise a dialect that the installed engine cannot parse.
const sources: Record<(typeof DIAGRAM_KINDS)[number], string> = {
  flowchart: 'flowchart LR\nA[Start] --> B[Finish]',
  sequenceDiagram: 'sequenceDiagram\nA->>B: Request\nB-->>A: Response',
  'stateDiagram-v2': 'stateDiagram-v2\n[*] --> Ready\nReady --> [*]',
  erDiagram: 'erDiagram\nUSER ||--o{ ORDER : places',
  gantt: 'gantt\ntitle Schedule\ndateFormat YYYY-MM-DD\nTask :a, 2026-01-01, 2d',
  pie: 'pie\n"One" : 60\n"Two" : 40',
  'xychart-beta': 'xychart-beta\nx-axis [Jan, Feb, Mar]\ny-axis "Count" 0 --> 30\nbar [10, 20, 30]',
  classDiagram: 'classDiagram\nclass User\nUser : +name',
  mindmap: 'mindmap\n  root((Project))\n    Research\n    Build',
  timeline: 'timeline\ntitle Roadmap\n2026 : Research\n2027 : Release',
  quadrantChart: 'quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nSample: [0.3, 0.6]',
  'sankey-beta': 'sankey-beta\nInput,Build,12\nBuild,Output,10\nBuild,Waste,2',
  'radar-beta':
    'radar-beta\naxis Speed, Quality, Cost\ncurve Current{4, 8, 6}\ncurve Target{8, 9, 7}',
  'treemap-beta': 'treemap-beta\n"Project"\n  "Research": 30\n  "Build": 70',
  gitGraph: 'gitGraph\ncommit\nbranch feature\ncheckout feature\ncommit',
}

test('every diagram kind advertised to the agent parses in the installed Mermaid engine', async () => {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true })
  for (const kind of DIAGRAM_KINDS) {
    expect(await mermaid.parse(sources[kind]), kind).toBeTruthy()
  }
})
