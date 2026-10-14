/**
 * Generate a large, realistic English coding-agent session (ChatMessage[] in our
 * persisted shape) and write it as JSON, for running check-compression against:
 *   bun apps/api/scripts/gen-mock-session.ts [outPath] [--turns N]
 *   bun run check:compression <outPath>
 *
 * The session mimics building a React/Vite app: reading config + source, writing
 * many components, re-reading and re-writing some (supersession), editing, and
 * running bash builds (non-recoverable). Deterministic — no randomness.
 */
import { writeFileSync } from 'node:fs'
import type { ChatMessage } from '@localixai/agent'
import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'

const outPath =
  process.argv.find((a) => !a.startsWith('--') && a.endsWith('.json')) ?? '/tmp/mock-session.json'
const turnsArg = process.argv.find((a) => a.startsWith('--turns'))
const TURNS = turnsArg
  ? Number(turnsArg.split('=')[1] ?? process.argv[process.argv.indexOf(turnsArg) + 1])
  : 24

let seq = 0
const id = (p: string) => `${p}-${seq++}`

function tsxContent(name: string, size: number): string {
  const body = Array.from(
    { length: Math.ceil(size / 80) },
    (_, i) =>
      `  // ${name} line ${i}: render section ${i} with responsive layout and accessibility roles`,
  ).join('\n')
  return `import { useState, useEffect } from 'react'\nimport styles from './${name}.module.css'\n\nexport default function ${name}() {\n  const [open, setOpen] = useState(false)\n  useEffect(() => { document.title = '${name}' }, [])\n${body}\n  return <section className={styles.root} aria-label="${name}">{/* ... */}</section>\n}\n`
}

function cssContent(name: string, size: number): string {
  const rules = Array.from(
    { length: Math.ceil(size / 60) },
    (_, i) =>
      `.${name.toLowerCase()}-${i} { display: flex; gap: ${i}px; color: var(--c-${i}); padding: ${i}px; }`,
  ).join('\n')
  return `.root { max-width: 1200px; margin: 0 auto; }\n${rules}\n`
}

function bashOutput(cmd: string, lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `> ${cmd} :: log line ${i} — compiled module chunk ${i} ok`,
  ).join('\n')
}

const toolItem = (name: string, input: unknown, resultText: string): ToolCallItem => ({
  type: 'tool_call',
  id: id('item'),
  status: 'completed',
  toolCallId: id('call'),
  name,
  input,
  resultText,
  output: resultText,
  activeVerb: name,
})

const messages: ChatMessage[] = []
const userMsg = (text: string) => messages.push({ id: id('m'), role: 'user', content: text })
const asstMsg = (text: string, tools: ToolCallItem[]) => {
  const items: AgentItem[] = [{ type: 'text', id: id('item'), status: 'completed', text }, ...tools]
  messages.push({ id: id('m'), role: 'assistant', content: text, items })
}

const components = [
  'Header',
  'Hero',
  'Features',
  'Pricing',
  'Testimonials',
  'About',
  'Team',
  'FAQ',
  'Contact',
  'Footer',
  'Navbar',
  'Sidebar',
  'Gallery',
  'Stats',
  'CTA',
  'Blog',
  'Newsletter',
  'Banner',
  'Cards',
  'Modal',
]

// --- Turn 1: scope + recon ---
userMsg(
  'Build a polished marketing landing page in React 19 + Vite with TypeScript. Sections: header, hero, features, pricing, testimonials, FAQ, contact, footer. Dark mode, responsive, accessible. Use CSS modules.',
)
asstMsg("I'll scan the project first, then scaffold the components.", [
  toolItem(
    'read',
    { path: 'package.json' },
    JSON.stringify({ name: 'site', dependencies: { react: '^19', 'react-dom': '^19' } }, null, 2),
  ),
  toolItem(
    'read',
    { path: 'tsconfig.json' },
    JSON.stringify(
      { compilerOptions: { jsx: 'react-jsx', strict: true, module: 'ESNext' } },
      null,
      2,
    ),
  ),
  toolItem('bash', { command: 'ls -R src' }, bashOutput('ls', 12)),
  toolItem('bash', { command: 'npm run build' }, bashOutput('vite build', 40)),
  toolItem(
    'write',
    { path: 'src/plan.md', content: tsxContent('Plan', 2500) },
    'Wrote 2.5KB to src/plan.md',
  ),
])

userMsg('Looks good, proceed.')

// --- Build turns: each turn writes 2-3 components + reads + a build ---
for (let t = 0; t < TURNS; t++) {
  const comp = components[t % components.length]
  const comp2 = components[(t + 1) % components.length]
  const parts: ToolCallItem[] = [
    toolItem(
      'write',
      { path: `src/components/${comp}/${comp}.tsx`, content: tsxContent(comp, 3000) },
      `Wrote 3.0KB to ${comp}.tsx`,
    ),
    toolItem(
      'write',
      { path: `src/components/${comp}/${comp}.module.css`, content: cssContent(comp, 2000) },
      `Wrote 2.0KB to ${comp}.module.css`,
    ),
    toolItem('read', { path: `src/components/${comp}/${comp}.tsx` }, tsxContent(comp, 3000)), // read back (superseded by the write above? no — same turn; later re-reads supersede)
    toolItem('bash', { command: `npm run build -- --filter ${comp}` }, bashOutput('build', 18)),
  ]
  // Every 3rd turn: re-read + re-write an EARLIER component (supersession) + an edit.
  if (t % 3 === 2) {
    parts.push(
      toolItem('read', { path: `src/components/${comp2}/${comp2}.tsx` }, tsxContent(comp2, 3000)),
    )
    parts.push(
      toolItem(
        'edit',
        {
          path: `src/components/${comp2}/${comp2}.tsx`,
          edits: [
            { oldText: 'useState(false)', newText: 'useState(true)' },
            { oldText: 'document.title', newText: 'window.document.title' },
          ],
        },
        'Applied 2 edits',
      ),
    )
    parts.push(
      toolItem(
        'write',
        { path: `src/components/${comp2}/${comp2}.module.css`, content: cssContent(comp2, 2200) },
        `Wrote 2.2KB to ${comp2}.module.css`,
      ),
    ) // supersedes earlier css write
  }
  asstMsg(`Adding the ${comp} section and wiring styles.`, parts)
  userMsg(t % 4 === 0 ? `Now do ${comp2} too, and make sure it builds.` : 'Continue.')
}

// --- Final turn: verify ---
asstMsg('Running the full build and a quick lint to verify everything compiles.', [
  toolItem('bash', { command: 'npm run build' }, bashOutput('vite build', 60)),
  toolItem('bash', { command: 'npm run lint' }, bashOutput('eslint', 30)),
  toolItem('read', { path: 'src/App.tsx' }, tsxContent('App', 4000)),
])

writeFileSync(outPath, JSON.stringify(messages, null, 0))
const chars = JSON.stringify(messages).length
console.log(
  `wrote ${messages.length} messages (~${Math.ceil(chars / 4).toLocaleString()} payload tokens) → ${outPath}`,
)
