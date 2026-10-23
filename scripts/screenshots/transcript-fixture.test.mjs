import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import {
  deserializeMessagePayload,
  serializeMessagePayload,
} from '../../apps/api/src/db/payload-codec.ts'
import { writeTranscript } from './transcript-fixture.mjs'

function captureDb() {
  const db = new Database(':memory:', { strict: true })
  db.run(
    'CREATE TABLE agent_messages(id TEXT PRIMARY KEY,session_id TEXT,user_id TEXT,sequence INTEGER,role TEXT,payload_json TEXT,parent_id TEXT)',
  )
  db.run(
    'CREATE TABLE agent_sessions(id TEXT PRIMARY KEY,leaf_id TEXT,last_message_at TEXT,updated_at TEXT)',
  )
  db.run("INSERT INTO agent_sessions(id) VALUES ('s1')")
  return db
}

const rows = [
  { role: 'user', content: 'Run the migrations.' },
  { role: 'assistant', content: 'Running the migrations.' },
]

test('writes the rows as one chain and points the session leaf at the last', () => {
  const db = captureDb()
  writeTranscript(db, 's1', 'capture-x', rows, serializeMessagePayload)
  const written = db
    .query(
      'SELECT id,user_id,sequence,role,parent_id,payload_json FROM agent_messages ORDER BY sequence',
    )
    .all()
  expect(written.map(({ payload_json: _payload, ...row }) => row)).toEqual([
    { id: 'capture-x-s1-0', user_id: 'local-user', sequence: 1, role: 'user', parent_id: null },
    {
      id: 'capture-x-s1-1',
      user_id: 'local-user',
      sequence: 2,
      role: 'assistant',
      parent_id: 'capture-x-s1-0',
    },
  ])
  expect(written[1] && deserializeMessagePayload(written[1].payload_json)).toMatchObject({
    id: 'capture-x-s1-1',
    content: 'Running the migrations.',
  })
  const session = db.query('SELECT * FROM agent_sessions WHERE id=?').get('s1')
  expect(session.leaf_id).toBe('capture-x-s1-1')
  expect(session.last_message_at).toBe(session.updated_at)
})

test('a reseed replaces the transcript instead of adding to it', () => {
  const db = captureDb()
  db.run(
    "INSERT INTO agent_messages(id,session_id,sequence,role,payload_json) VALUES ('stale','s1',1,'user','{}')",
  )
  writeTranscript(db, 's1', 'capture-x', rows, serializeMessagePayload)
  writeTranscript(db, 's1', 'capture-x', rows, serializeMessagePayload)
  const ids = db.query('SELECT id FROM agent_messages ORDER BY sequence').all()
  expect(ids).toEqual([{ id: 'capture-x-s1-0' }, { id: 'capture-x-s1-1' }])
})
