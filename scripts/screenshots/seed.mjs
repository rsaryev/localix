import { promises as fs } from 'node:fs'
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
import { seedExternal } from './external-workbench.mjs'
import { ensureDemoAgents } from './demo-agents.mjs'
import { seedFixtureChat } from './fixture-chat.mjs'
import { seedUnfinishedReply } from './unfinished-reply.mjs'
import { seedToolSections } from './tool-sections.mjs'
import { seedAgentChildren } from './agent-children.mjs'

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
await seedExternal(fixture)
await seedFixtureChat(fixture)
await seedUnfinishedReply(fixture)
await seedToolSections(fixture)
await seedAgentChildren(fixture)
await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
console.log('Demo seeded without credentials or model calls.')
