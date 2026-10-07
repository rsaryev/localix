import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { parseSessionArgs, readAuditSessions, readAuditUsage } from './session-audit-store'

describe('session audit evidence', () => {
  test('flags can precede the session without turning a database path into its id', () => {
    expect(parseSessionArgs(['--db', 'fixture.db', '--tree', 'root'], ['db'])).toEqual({
      sessionId: 'root',
      values: { db: 'fixture.db' },
      tree: true,
    })
    expect(() => parseSessionArgs(['--db'], ['db'])).toThrow('missing value')
    expect(() => parseSessionArgs(['root', '--unknown', 'x'], ['db'])).toThrow('Unknown option')
  })

  test('tree accounting includes descendants and auxiliary usage exactly once', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`CREATE TABLE agent_sessions (
        id TEXT, parent_session_id TEXT, title TEXT, runtime_status TEXT, created_at TEXT
      ); CREATE TABLE agent_messages (id TEXT);
      CREATE TABLE usage_events (
        message_id TEXT, session_id TEXT, input_tokens INTEGER, cache_read_tokens INTEGER,
        output_tokens INTEGER, cost_usd REAL, cost_source TEXT
      );
      INSERT INTO agent_sessions VALUES ('root', NULL, 'root', 'idle', '1'),
        ('child', 'root', 'child', 'completed', '2'),
        ('grandchild', 'child', 'grandchild', 'failed', '3'),
        ('unrelated', NULL, 'other', 'idle', '4');
      INSERT INTO agent_messages VALUES ('reply');
      INSERT INTO usage_events VALUES ('reply', 'root', 100, 80, 10, 0.1, 'subscription'),
        ('aux', 'root', 30, 0, 5, 0.02, 'subscription'),
        ('child-reply', 'child', 60, 50, 8, NULL, 'unknown'),
        ('grandchild-reply', 'grandchild', 20, 10, 2, 0.03, 'estimated'),
        ('other', 'unrelated', 999, 0, 1, 1, 'actual');`)
      const ids = readAuditSessions(db, 'root', true).map((session) => session.id)
      expect(ids).toEqual(['root', 'child', 'grandchild'])
      const usage = readAuditUsage(db, [...ids, 'child'])
      expect(usage.input).toBe(210)
      expect(usage.output).toBe(25)
      expect(usage.cached).toBe(140)
      expect(usage.cost).toBeCloseTo(0.15)
      expect(usage.unpriced).toBe(1)
      expect(usage.auxiliary).toBe(3)
      expect(usage.sources).toEqual(['estimated', 'subscription', 'unknown'])
      expect(() => readAuditSessions(db, 'missing', true)).toThrow('Session not found')
      db.exec("UPDATE agent_sessions SET parent_session_id = 'grandchild' WHERE id = 'root'")
      expect(readAuditSessions(db, 'root', true)).toHaveLength(3)
    } finally {
      db.close()
    }
  })
})
