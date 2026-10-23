import { describe, expect, it } from 'bun:test'
import {
  MAX_RESULT_TABS,
  OUTPUT_TAB_ID,
  activeTab,
  activateTab,
  appendOutput,
  clearOutput,
  closeTab,
  deriveSqlLabel,
  emptyResultTabsState,
  formatDurationMs,
  formatOutputLogText,
  formatSqlTimestamp,
  normalizeSql,
  openOrReuseResult,
  outputEntryResultLine,
  outputResultText,
  sqlKey,
  tableKey,
  type OutputEntry,
  type ResultOutcome,
  type ResultTabsState,
} from './resultTabs'

const outcome = (rows = 1): ResultOutcome => ({
  result: {
    columns: [{ id: 'a', title: 'a', type: 'int' }],
    rows: Array.from({ length: rows }, () => ({ a: 1 })),
  },
  durationMs: 5,
})

function openQuery(state: ResultTabsState, sql: string): ResultTabsState {
  return openOrReuseResult(state, {
    key: sqlKey(sql),
    label: deriveSqlLabel(sql),
    sql,
    browse: null,
    outcome: outcome(),
  })
}
function openTable(state: ResultTabsState, table: string, schema?: string): ResultTabsState {
  return openOrReuseResult(state, {
    key: tableKey(table, schema),
    label: table,
    sql: `SELECT * FROM ${table}`,
    browse: { table, schema },
    outcome: outcome(),
  })
}

describe('normalizeSql', () => {
  it('trims, collapses whitespace, lowercases, drops trailing semicolon', () => {
    expect(normalizeSql('  SELECT   *\n FROM  Users ;  ')).toBe('select * from users')
  })
})

describe('normalizeSql keeps literals and quoted names as typed', () => {
  it('does not merge queries that differ only inside a literal or quoted identifier', () => {
    expect(normalizeSql("SELECT * FROM t WHERE name = 'Bob'")).not.toBe(
      normalizeSql("select * from t where name = 'bob'"),
    )
    expect(normalizeSql('SELECT * FROM "User"')).not.toBe(normalizeSql('SELECT * FROM "user"'))
    expect(normalizeSql("SELECT 'a  b'")).toBe("select 'a  b'")
    expect(normalizeSql("  SELECT  *  FROM t WHERE n = 'X' ; ")).toBe(
      "select * from t where n = 'X'",
    )
  })
})

describe('deriveSqlLabel', () => {
  it('labels by the top-level FROM, not one inside a literal or select-list subquery', () => {
    expect(deriveSqlLabel("SELECT 'from x' AS s, (SELECT max(id) FROM a) FROM b")).toBe('SELECT b…')
  })

  it('labels a SELECT by its FROM table', () => {
    expect(deriveSqlLabel('select id, name from user where x = 1')).toBe('SELECT user…')
  })
  it('strips quoting on the table name', () => {
    expect(deriveSqlLabel('SELECT * FROM "public"."user"')).toBe('SELECT public.user…')
  })
  it('truncates non-SELECT statements to 28 chars', () => {
    expect(deriveSqlLabel('PRAGMA table_info(a_very_long_table_name_here)')).toBe(
      'PRAGMA table_info(a_very_lon…',
    )
  })
})

describe('dedup', () => {
  it('re-running the same query reuses ONE tab and re-activates it', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT * FROM user')
    const firstId = s.activeId
    // Whitespace/case variation → same identity → same tab.
    s = openQuery(s, 'select  *  from   USER;')
    expect(s.tabs.filter((t) => t.kind === 'result')).toHaveLength(1)
    expect(s.activeId).toBe(firstId)
  })

  it('different queries produce two tabs', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT * FROM user')
    s = openQuery(s, 'SELECT * FROM orders')
    expect(s.tabs.filter((t) => t.kind === 'result')).toHaveLength(2)
  })

  it('re-opening the same table reuses its tab (identity by schema+table, not SQL)', () => {
    let s = emptyResultTabsState()
    s = openTable(s, 'user', 'public')
    s = openTable(s, 'user', 'public')
    expect(s.tabs.filter((t) => t.kind === 'result')).toHaveLength(1)
  })

  it('a table tab and an ad-hoc query on the same table are distinct identities', () => {
    let s = emptyResultTabsState()
    s = openTable(s, 'user')
    s = openQuery(s, 'SELECT id FROM user')
    expect(s.tabs.filter((t) => t.kind === 'result')).toHaveLength(2)
  })
})

describe('Output singleton', () => {
  it('appends to ONE Output tab across many non-row outcomes', () => {
    let s = emptyResultTabsState()
    s = appendOutput(s, {
      at: 1,
      sql: 'UPDATE user SET x=1',
      durationMs: 2,
      status: 'ok',
      kind: 'affected',
      rowsAffected: 1,
      message: '1 row affected',
    })
    s = appendOutput(s, {
      at: 2,
      sql: 'DROP TABLE t',
      durationMs: 3,
      status: 'ok',
      kind: 'ddl',
      message: 'completed',
    })
    const out = s.tabs.filter((t) => t.id === OUTPUT_TAB_ID)
    expect(out).toHaveLength(1)
    expect(out[0].log).toHaveLength(2)
    expect(s.activeId).toBe(OUTPUT_TAB_ID)
  })

  it('errors go to the Output log', () => {
    let s = emptyResultTabsState()
    s = appendOutput(s, {
      at: 1,
      sql: 'boom',
      durationMs: 1,
      status: 'error',
      kind: 'error',
      message: 'syntax error',
      errorCode: 'syntax_error',
    })
    expect(activeTab(s)?.log?.[0].status).toBe('error')
  })

  it('clearOutput empties the log but keeps the tab (and is a no-op with no Output tab)', () => {
    expect(clearOutput(emptyResultTabsState()).tabs).toHaveLength(0) // no-op
    let s = appendOutput(emptyResultTabsState(), {
      at: 1,
      sql: 'x',
      durationMs: 1,
      status: 'ok',
      kind: 'ddl',
      message: 'completed',
    })
    s = clearOutput(s)
    const out = s.tabs.filter((t) => t.id === OUTPUT_TAB_ID)
    expect(out).toHaveLength(1)
    expect(out[0].log).toHaveLength(0)
  })

  it('logs a SELECT without stealing focus from its result tab (activate: false)', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT * FROM user') // opens + activates the result tab
    const resultId = s.activeId
    s = appendOutput(
      s,
      {
        at: 3,
        sql: 'SELECT * FROM user',
        durationMs: 4,
        status: 'ok',
        kind: 'select',
        rowCount: 2,
        message: '2 rows retrieved',
      },
      false,
    )
    // The Output tab exists + captured the SELECT, but the result tab stays active.
    expect(s.tabs.find((t) => t.id === OUTPUT_TAB_ID)?.log).toHaveLength(1)
    expect(s.activeId).toBe(resultId)
  })
})

describe('output line text', () => {
  it('prefers the raw engine detail over the friendly message on error', () => {
    expect(
      outputResultText({
        at: 1,
        sql: 'INSERT INTO `user` VALUES (1)',
        durationMs: 0,
        status: 'error',
        kind: 'error',
        message: 'The query failed.',
        detail: "Duplicate entry '1' for key 'PRIMARY'",
      }),
    ).toBe("Duplicate entry '1' for key 'PRIMARY'")
  })

  it('falls back to the friendly message when there is no detail', () => {
    expect(
      outputResultText({
        at: 1,
        sql: 'boom',
        durationMs: 0,
        status: 'error',
        kind: 'error',
        message: 'The query failed.',
      }),
    ).toBe('The query failed.')
  })

  it('returns the summary message for an ok outcome', () => {
    expect(
      outputResultText({
        at: 1,
        sql: 'UPDATE t SET x=1',
        durationMs: 5,
        status: 'ok',
        kind: 'affected',
        rowsAffected: 3,
        message: '3 rows affected',
      }),
    ).toBe('3 rows affected')
  })
})

describe('formatSqlTimestamp', () => {
  it('renders a local absolute YYYY-MM-DD HH:MM:SS stamp', () => {
    // Constructed in local time → local getters read it back deterministically (TZ-agnostic).
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatSqlTimestamp(at)).toBe('2026-01-02 03:04:05')
  })
})

describe('eviction at cap', () => {
  it('evicts the oldest result tab when exceeding MAX_RESULT_TABS, keeping the newest', () => {
    let s = emptyResultTabsState()
    for (let i = 0; i < MAX_RESULT_TABS + 1; i++) s = openQuery(s, `SELECT ${i}`)
    const result = s.tabs.filter((t) => t.kind === 'result')
    expect(result).toHaveLength(MAX_RESULT_TABS)
    // The very first query (SELECT 0) was evicted; the latest is active + present.
    expect(result.some((t) => t.id === sqlKey('SELECT 0'))).toBe(false)
    expect(s.activeId).toBe(sqlKey(`SELECT ${MAX_RESULT_TABS}`))
  })

  it('the Output singleton is never evicted by the result-tab cap', () => {
    let s = emptyResultTabsState()
    s = appendOutput(s, {
      at: 1,
      sql: 'x',
      durationMs: 1,
      status: 'ok',
      kind: 'affected',
      rowsAffected: 0,
      message: '0 rows affected',
    })
    for (let i = 0; i < MAX_RESULT_TABS + 3; i++) s = openQuery(s, `SELECT ${i}`)
    expect(s.tabs.some((t) => t.id === OUTPUT_TAB_ID)).toBe(true)
    expect(s.tabs.filter((t) => t.kind === 'result')).toHaveLength(MAX_RESULT_TABS)
  })
})

describe('close + activate', () => {
  it('closing the active tab activates the most-recent remaining', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT a')
    const aId = s.activeId!
    s = openQuery(s, 'SELECT b')
    const bId = s.activeId!
    s = activateTab(s, aId) // focus the older one, then close it
    s = closeTab(s, aId)
    expect(s.tabs.some((t) => t.id === aId)).toBe(false)
    expect(s.activeId).toBe(bId)
  })

  it('closing the last tab leaves no active tab', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT a')
    s = closeTab(s, s.activeId!)
    expect(s.tabs).toHaveLength(0)
    expect(s.activeId).toBeNull()
  })

  it('closing a non-active tab keeps the active one', () => {
    let s = emptyResultTabsState()
    s = openQuery(s, 'SELECT a')
    const aId = s.activeId!
    s = openQuery(s, 'SELECT b')
    const bId = s.activeId!
    s = closeTab(s, aId)
    expect(s.activeId).toBe(bId)
  })
})

describe('formatOutputLogText (captured as a chat snippet)', () => {
  it('renders each entry as [ts] db> sql / [ts] result, blank-line separated', () => {
    const log: OutputEntry[] = [
      {
        at: 1000,
        db: 'mydb',
        sql: 'SELECT 1',
        durationMs: 12,
        status: 'ok',
        kind: 'select',
        rowCount: 1,
        message: '1 row retrieved',
      },
      {
        at: 2000,
        db: 'mydb',
        sql: 'DROP TABLE t',
        durationMs: 3,
        status: 'error',
        kind: 'error',
        message: 'nope',
        detail: "table t doesn't exist",
      },
    ]
    const ts0 = formatSqlTimestamp(1000)
    const ts1 = formatSqlTimestamp(2000)
    expect(formatOutputLogText(log)).toBe(
      `[${ts0}] mydb> SELECT 1\n[${ts0}] 1 row retrieved in 12 ms\n\n` +
        `[${ts1}] mydb> DROP TABLE t\n[${ts1}] table t doesn't exist`,
    )
  })

  it('falls back to a sql> prompt when the entry has no db', () => {
    expect(
      formatOutputLogText([
        { at: 0, sql: 'X', durationMs: 1, status: 'ok', kind: 'ddl', message: 'completed' },
      ]),
    ).toContain('sql> X')
  })

  it('empty log → empty string', () => {
    expect(formatOutputLogText([])).toBe('')
  })
})

describe('outputEntryResultLine / formatDurationMs', () => {
  it('ok → "<summary> in <ms>"; error → engine detail', () => {
    expect(
      outputEntryResultLine({
        at: 0,
        sql: 'x',
        durationMs: 1500,
        status: 'ok',
        kind: 'affected',
        rowsAffected: 2,
        message: '2 rows affected',
      }),
    ).toBe('2 rows affected in 1.50 s')
    expect(
      outputEntryResultLine({
        at: 0,
        sql: 'x',
        durationMs: 1,
        status: 'error',
        kind: 'error',
        message: 'fail',
        detail: 'boom',
      }),
    ).toBe('boom')
  })

  it('formatDurationMs: ms under a second, seconds above', () => {
    expect(formatDurationMs(12)).toBe('12 ms')
    expect(formatDurationMs(1500)).toBe('1.50 s')
    expect(formatDurationMs(12000)).toBe('12.0 s')
  })
})
