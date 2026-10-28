import { promises as fs } from 'node:fs'
import path from 'node:path'
import { api, fixtureFile } from './runtime.mjs'

/**
 * A release flow drawn with the board's own elements: shapes with marks in their labels, elbow
 * connectors whose captions sit beside the line, and sticky notes set in different faces — the
 * evidence for text styles and connector captions. Its own project and chat, so it never moves
 * what the answer-board capture shows.
 */
const shape = (id, x, y, text, props = {}, size = { w: 200, h: 96 }) => ({
  op: 'create',
  id,
  type: 'shape',
  x,
  y,
  ...size,
  props: { kind: 'rounded', color: 'gray', fill: 'tint', text, ...props },
})

const elements = [
  {
    op: 'create',
    id: 'flow',
    type: 'frame',
    x: 0,
    y: 0,
    w: 1240,
    h: 560,
    props: { title: 'Release flow' },
  },
  {
    op: 'create',
    id: 'flow-title',
    type: 'text',
    x: 40,
    y: 40,
    w: 560,
    h: 60,
    props: { text: 'From scope to a shipped release', size: 'lg', font: 'serif' },
  },
  shape('plan', 40, 200, '**Plan**\n`scope · owners`', { color: 'blue' }),
  shape('build', 340, 200, '**Build**\n`bun run build`'),
  shape('ready', 660, 184, 'Ready?', { kind: 'diamond', color: 'yellow' }, { w: 180, h: 128 }),
  shape('ship', 980, 200, '**Ship**\nv1.4', { color: 'green', fill: 'solid' }),
  shape(
    'fix',
    660,
    400,
    'Fix the *failing* check',
    { color: 'red', stroke: 'dashed' },
    { w: 180, h: 96 },
  ),
  {
    op: 'create',
    id: 'before',
    type: 'note',
    x: 1300,
    y: 40,
    w: 260,
    h: 240,
    props: {
      color: 'yellow',
      text: '**Before shipping**\n- [x] Interface review\n- [x] Mobile layout\n- [ ] Release notes',
    },
  },
  {
    op: 'create',
    id: 'reminder',
    type: 'note',
    x: 1300,
    y: 320,
    w: 260,
    h: 200,
    props: {
      color: 'green',
      font: 'hand',
      align: 'center',
      valign: 'middle',
      text: 'Keep the release *small* and ==reversible==',
    },
  },
]

// The same release, written as Mermaid by an agent and drawn natively: it lays itself out.
elements.push({
  op: 'create',
  id: 'release-chart',
  type: 'flow',
  x: 0,
  y: 640,
  text: [
    'flowchart LR',
    '  pr([Pull request]) --> ci{CI green?}',
    '  ci -->|yes| review[Review<br/>2 approvals]',
    '  ci -.->|no| fix[Fix the build]',
    '  fix --> ci',
    '  subgraph ship [Release]',
    '    tag[Tag v1.4<br/>git tag]:::focal --> publish[(Registry)]',
    '  end',
    '  review ==> tag',
  ].join('\n'),
  props: { title: 'Release pipeline', color: 'green' },
})

// What to do first, placed by impact and effort; the one bet the matrix is about is focal.
elements.push({
  op: 'create',
  id: 'bets',
  type: 'quadrant',
  x: 1300,
  y: 640,
  w: 520,
  h: 420,
  text: [
    'quadrantChart',
    '  title Next quarter',
    '  x-axis Low effort --> High effort',
    '  y-axis Low impact --> High impact',
    '  quadrant-1 Major projects',
    '  quadrant-2 Do first',
    '  quadrant-3 Fill-ins',
    '  quadrant-4 Avoid',
    '  Offline mode:::focal: [0.28, 0.82]',
    '  Release notes: [0.2, 0.62]',
    '  New editor: [0.78, 0.76]',
    '  Rename settings: [0.32, 0.22]',
    '  Rewrite sync: [0.84, 0.3]',
  ].join('\n'),
  props: { color: 'orange' },
})

const edges = [
  { op: 'connect', id: 'e-plan', from: 'plan', to: 'build', route: 'elbow', label: 'scope' },
  { op: 'connect', id: 'e-build', from: 'build', to: 'ready', route: 'elbow' },
  {
    op: 'connect',
    id: 'e-pass',
    from: 'ready',
    to: 'ship',
    route: 'elbow',
    label: 'passes',
    color: 'green',
    weight: 'bold',
  },
  {
    op: 'connect',
    id: 'e-fail',
    from: 'ready',
    to: 'fix',
    route: 'elbow',
    label: 'fails',
    color: 'red',
    stroke: 'dashed',
  },
  {
    op: 'connect',
    id: 'e-retry',
    from: 'fix',
    to: 'build',
    route: 'elbow',
    fromSide: 'left',
    toSide: 'bottom',
    label: 'retry',
    stroke: 'dashed',
  },
]

export async function seedDiagramBoard(fixture) {
  const root = path.join(path.dirname(fixture.root), 'diagram-studio')
  await fs.mkdir(root, { recursive: true })
  const result = await api('/projects')
  const projects = Array.isArray(result) ? result : result.projects
  const project =
    projects.find((item) => item.workingDir === root) ??
    (await api('/projects', { name: 'Diagram Studio', workingDir: root }))
  if (!fixture.diagramSessionId) {
    const session = await api('/sessions', {
      title: 'Draw the release flow',
      projectId: project.id,
      agentId: 'builtin:localix',
    })
    fixture.diagramSessionId = session.id
  }
  if (fixture.diagramProjectId !== project.id) {
    fixture.diagramProjectId = project.id
    // Kept, so a rerun draws on the same board instead of opening another chat.
    await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
  }
  const route = `?sessionId=${fixture.diagramSessionId}`
  const { space } = await api(`/project-space/space${route}`)
  // The capture shows this board exactly: what an earlier look added (a chart taken apart into
  // shapes, a moved note) is removed, and what it removed is drawn again.
  const wanted = new Set([...elements, ...edges].map((op) => op.id))
  const stray = [...Object.keys(space.elements), ...Object.keys(space.edges)]
    .filter((id) => !wanted.has(id))
    .map((id) => ({ op: 'delete', id }))
  const ops = [
    ...stray,
    ...[...elements, ...edges].filter((op) => !space.elements[op.id] && !space.edges[op.id]),
  ]
  // A batch takes at most 200 operations.
  for (let at = 0; at < ops.length; at += 200)
    await api(`/project-space/ops${route}`, { ops: ops.slice(at, at + 200) })
}
