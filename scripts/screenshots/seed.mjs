import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { serializeMessagePayload } from '../../apps/api/src/db/payload-codec.ts'
import {
  api,
  prepare,
  verifyDemoRuntime,
  databaseFile,
  fixtureFile,
  installEveryMiniApp,
} from './runtime.mjs'
import { createTemplateDocument } from '../../mini-apps/resume/shared/templates.ts'
import { seedContent } from './content-workbenches.mjs'
import { seedGames } from './game-workbenches.mjs'
import { seedDeveloper } from './developer-workbenches.mjs'
import { seedExternal } from './external-workbench.mjs'
import { seedPlatformViews } from './platform-views.mjs'
import { seedPlatform } from './platform-fixture.mjs'
import { seedAnswerBoard } from './board-fixture.mjs'
import { ensureDemoAgents } from './demo-agents.mjs'
import { seedFixtureChat } from './fixture-chat.mjs'
import { seedUnfinishedReply } from './unfinished-reply.mjs'
import { seedToolSections } from './tool-sections.mjs'
import { seedAgentChildren } from './agent-children.mjs'
import { emptyEntry } from '../../mini-apps/resume/shared/schema.ts'

await verifyDemoRuntime()
const root = await prepare()
await installEveryMiniApp()
const projects = await api('/projects')
const projectList = Array.isArray(projects) ? projects : projects.projects
const project =
  projectList.find((item) => item.workingDir === root) ??
  (await api('/projects', { name: 'Release Studio', workingDir: root }))
const demoAgents = await ensureDemoAgents(project.id)
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
    agentId: demoAgents.localix,
  })
  fixture = { root, projectId: project.id, sessionId: session.id }
}
const sessionRoute = (route) => `${route}?sessionId=${fixture.sessionId}`
const db = new Database(databaseFile, { strict: true })
const messages = [
  {
    role: 'user',
    content:
      '@localix Prepare the workspace update. Keep source, preview and release checks together.',
  },
  {
    role: 'assistant',
    handle: 'localix',
    content:
      'I’ll keep the plan here.\n\n### Release checklist\n- Review the workspace layout\n- Check the mobile preview\n- Finish the release notes',
  },
  {
    role: 'assistant',
    handle: 'localix',
    content:
      'The desktop and mobile layouts are ready. Source and preview share the same workspace.',
  },
  {
    role: 'assistant',
    handle: 'localix',
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
      id,
      role: message.role,
      content: message.content,
      ...(message.role === 'assistant'
        ? {
            dataParts: [
              {
                type: 'data-context-window',
                data: { fullWindowTokens: 12000, ceilingTokens: 6000 },
              },
            ],
            usage: {
              contextTokens: (i + 1) * 1_000,
              inputTokens: (i + 1) * 1_000,
              outputTokens: (i + 1) * 100,
              totalTokens: (i + 1) * 1_100,
              cachedInputTokens: i * 500,
              totalCost: (i + 1) * 0.01,
              costSource: 'estimated',
            },
          }
        : {}),
      ...(message.handle
        ? {
            from: `agent:${demoAgents[message.handle]}`,
            authorSnapshot: { handle: message.handle },
            items: [{ type: 'text', id: `text-${i}`, status: 'completed', text: message.content }],
          }
        : {}),
    }
    db.query(
      'INSERT INTO agent_messages(id,session_id,user_id,sequence,role,payload_json,parent_id) VALUES (?,?,?,?,?,?,?)',
    ).run(
      id,
      fixture.sessionId,
      'local-user',
      i + 1,
      message.role,
      serializeMessagePayload(payload),
      parent,
    )
    parent = id
  }
  db.query('UPDATE agent_sessions SET leaf_id=?,last_message_at=?,updated_at=? WHERE id=?').run(
    parent,
    new Date().toISOString(),
    new Date().toISOString(),
    fixture.sessionId,
  )
}
// Older isolated fixtures bypassed the message codec; retain their composed content
// while repairing only this script's own rows before a screenshot can read them.
for (const [index] of messages.entries()) {
  const id = `capture-${fixture.sessionId}-${index}`
  const row = db
    .query('SELECT role,payload_json FROM agent_messages WHERE id=? AND session_id=?')
    .get(id, fixture.sessionId)
  if (!row) continue
  const payload = JSON.parse(row.payload_json)
  if (payload.v == null)
    db.query('UPDATE agent_messages SET payload_json=? WHERE id=?').run(
      serializeMessagePayload({ ...payload, id, role: row.role }),
      id,
    )
}
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
INSERT OR IGNORE INTO release_checks VALUES (1,'Review the workspace layout','Frontend','done'),(2,'Check the release states','QA','done'),(3,'Review the mobile preview','Frontend','in_progress'),(4,'Write release notes','Localix','ready');`,
})
await seedAnswerBoard(fixture)
await seedContent(fixture)
await seedPlatform(fixture)
await seedDeveloper(fixture)
await seedPlatformViews(fixture)
await seedGames(fixture)
await seedExternal(fixture)
await seedFixtureChat(fixture)
await seedUnfinishedReply(fixture)
await seedToolSections(fixture)
await seedAgentChildren(fixture)
fixture.resumeId = resume.id
fixture.connectionId = connection.id
await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
console.log('Demo seeded without credentials or model calls.')
