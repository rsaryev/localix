import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { api, prepare, verifyDemoRuntime, databaseFile, fixtureFile } from './runtime.mjs'
import { createTemplateDocument } from '../../plugins/resume/shared/templates.ts'
import { seedContent } from './content-workbenches.mjs'
import { seedGames } from './game-workbenches.mjs'
import { seedDeveloper } from './developer-workbenches.mjs'
import { seedExternal } from './external-workbench.mjs'
import { seedPlatformViews } from './platform-views.mjs'
import { seedPlatform } from './platform-fixture.mjs'
import { seedAnswerBoard } from './board-fixture.mjs'
import { emptyEntry } from '../../plugins/resume/shared/schema.ts'

await verifyDemoRuntime()
const root = await prepare()
const projects = await api('/projects')
const projectList = Array.isArray(projects) ? projects : projects.projects
const project =
  projectList.find((item) => item.workingDir === root) ??
  (await api('/projects', { name: 'Release Studio', workingDir: root }))
let fixture
try {
  fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
} catch {
  /* First seed. */
}
if (!fixture || fixture.projectId !== project.id) {
  const session = await api('/sessions', {
    title: 'Prepare the workspace update',
    projectId: project.id,
    agentIds: ['builtin:lead', 'builtin:frontend', 'builtin:qa'],
  })
  fixture = { root, projectId: project.id, sessionId: session.id }
}
const sessionRoute = (route) => `${route}?sessionId=${fixture.sessionId}`
const db = new Database(databaseFile, { strict: true })
const messages = [
  {
    role: 'user',
    content:
      '@lead Prepare the workspace update. Keep source, preview and release checks together.',
  },
  {
    role: 'assistant',
    handle: 'lead',
    content:
      'I’ll keep the plan here. @frontend reviews the interface; @qa checks the behavior.\n\n### Release checklist\n- Review the workspace layout\n- Check the mobile preview\n- Finish the release notes',
  },
  {
    role: 'assistant',
    handle: 'frontend',
    content:
      'The desktop and mobile layouts are ready. Source and preview share the same workspace.',
  },
  {
    role: 'assistant',
    handle: 'qa',
    content:
      'Both release states pass the checks. **Next:** finish the release notes and review the update.',
  },
]
const existing = db
  .query('SELECT count(*) AS n FROM agent_messages WHERE session_id=?')
  .get(fixture.sessionId)
if (!existing.n) {
  let parent = null
  for (const [i, message] of messages.entries()) {
    const id = `capture-${fixture.sessionId}-${i}`
    const payload = {
      content: message.content,
      ...(message.handle
        ? {
            from: `agent:builtin:${message.handle}`,
            authorSnapshot: { handle: message.handle },
            items: [{ type: 'text', id: `text-${i}`, status: 'completed', text: message.content }],
          }
        : {}),
    }
    db.query(
      'INSERT INTO agent_messages(id,session_id,user_id,sequence,role,payload_json,parent_id) VALUES (?,?,?,?,?,?,?)',
    ).run(id, fixture.sessionId, 'local-user', i + 1, message.role, JSON.stringify(payload), parent)
    parent = id
  }
  db.query('UPDATE agent_sessions SET leaf_id=?,last_message_at=?,updated_at=? WHERE id=?').run(
    parent,
    new Date().toISOString(),
    new Date().toISOString(),
    fixture.sessionId,
  )
}
// Durable demo question, restored into the real registry after restarting the capture API.
const question = [
  {
    id: 'release_scope',
    question: 'Which change should lead the release notes?',
    options: [
      { label: 'Shared workspace', description: 'Lead with source, preview and checks together.' },
      {
        label: 'Team collaboration',
        description: 'Lead with the group conversation and task board.',
      },
    ],
    recommended: 0,
  },
]
db.query(
  'INSERT OR IGNORE INTO agent_questions(id,user_id,session_id,agent_id,display_id,tool_call_id,questions_json,status,asked_at) VALUES (?,?,?,?,?,?,?,?,?)',
).run(
  'capture-release-scope',
  'local-user',
  fixture.sessionId,
  'builtin:lead',
  'q-1',
  'capture-ask',
  JSON.stringify(question),
  'pending',
  new Date().toISOString(),
)
db.close()
const result = await api(sessionRoute('/resume'))
const resumes = Array.isArray(result) ? result : result.resumes
let resume = resumes.find((item) => item.title === 'Product engineer — demo')
if (!resume) {
  const document = createTemplateDocument('awal', 'Product engineer — demo')
  document.header = {
    name: 'Alex Morgan',
    headline: 'Product Engineer',
    email: 'alex@example.com',
    phone: '',
    location: 'Remote',
    links: [{ label: 'Portfolio', url: 'https://example.com' }],
  }
  document.targetRole = 'Senior Product Engineer'
  for (const section of document.sections) {
    const entry = emptyEntry()
    if (section.type === 'summary')
      entry.body =
        'Product engineer building clear, reliable tools for collaborative teams. Combines interface design with full-stack implementation and focused testing.'
    if (section.type === 'experience')
      Object.assign(entry, {
        title: 'Product Engineer',
        organization: 'Example Studio',
        start: '2023',
        current: true,
        bullets: [
          'Built a shared workspace for product delivery and review.',
          'Shipped accessible interfaces across desktop and mobile.',
          'Improved release confidence with focused integration tests.',
        ],
      })
    if (section.type === 'education')
      Object.assign(entry, {
        title: 'BSc, Computer Science',
        organization: 'Example University',
        start: '2016',
        end: '2020',
      })
    if (section.type === 'projects')
      Object.assign(entry, {
        title: 'Release Studio',
        body: 'A product workspace connecting planning, implementation and release checks.',
      })
    if (section.type === 'skills') entry.title = 'TypeScript · React · SQL · UI design'
    section.entries = [entry]
  }
  resume = await api(sessionRoute('/resume'), { document })
}
const { connection } = await api('/database/connect', {
  name: 'Release Studio',
  config: { dialect: 'sqlite', file: path.join(root, 'release.sqlite') },
})
await api(`/database/${connection.id}/query`, {
  sql: `CREATE TABLE IF NOT EXISTS release_checks (id INTEGER PRIMARY KEY, title TEXT, owner TEXT, status TEXT);
INSERT OR IGNORE INTO release_checks VALUES (1,'Review the workspace layout','Frontend','done'),(2,'Check the release states','QA','done'),(3,'Review the mobile preview','Frontend','in_progress'),(4,'Write release notes','Team Lead','ready');`,
})
await seedAnswerBoard(fixture)
await seedContent(fixture)
await seedPlatform(fixture)
await seedDeveloper(fixture)
await seedPlatformViews(fixture)
await seedGames(fixture)
await seedExternal(fixture)
fixture.resumeId = resume.id
fixture.connectionId = connection.id
await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(
  'Demo seeded without credentials or model calls. Restart only the capture API to restore the queued question.',
)
