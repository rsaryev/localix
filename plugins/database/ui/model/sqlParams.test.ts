import { describe, expect, it } from 'bun:test'
import { compileSql, describeParams, paramKey, scanParams, typeParamValue } from './sqlParams'

describe('scanParams', () => {
  it('finds portable named and positional placeholders in source order', () => {
    const slots = scanParams('SELECT * FROM t WHERE a = :id AND b = ? AND c = :id', 'sqlite')
    expect(slots.map((slot) => slot.kind)).toEqual(['named', 'positional', 'named'])
    expect(slots.map((slot) => slot.key)).toEqual(['n:id', 'p:0', 'n:id'])
    expect(slots.map((slot) => slot.label)).toEqual([':id', '?1', ':id'])
  })

  it('recognizes driver-owned native spellings', () => {
    expect(scanParams('WHERE a = $1 AND b = $2 AND c = $1', 'postgres').map((s) => s.key)).toEqual([
      'p:0',
      'p:1',
      'p:0',
    ])
    expect(scanParams('WHERE a = @email AND b = :team', 'mssql').map((s) => s.key)).toEqual([
      'n:email',
      'n:team',
    ])
    expect(scanParams('WHERE a = ?1 AND b = $name', 'sqlite').map((s) => s.key)).toEqual([
      'p:0',
      'n:name',
    ])
  })

  it('does not leak another engine parameter grammar into a driver', () => {
    expect(scanParams('SELECT @session, $name', 'mysql')).toHaveLength(0)
    expect(scanParams('SELECT @session', 'postgres')).toHaveLength(0)
  })

  it('ignores placeholders inside literals, quoted identifiers and comments', () => {
    expect(scanParams("SELECT ':id', '?', \"$1\", `@name`, [?2] FROM t", 'sqlite')).toHaveLength(0)
    expect(scanParams('SELECT 1 -- :id ?\nFROM t', 'sqlite')).toHaveLength(0)
    expect(scanParams('SELECT 1 /* :id ? */ FROM t', 'sqlite')).toHaveLength(0)
  })

  it('ignores postgres casts and dollar-quoted function bodies', () => {
    expect(scanParams('SELECT a::text FROM t', 'postgres')).toHaveLength(0)
    expect(
      scanParams(
        "DO $body$ BEGIN RAISE NOTICE ':fake $1 ?'; END $body$; SELECT :real",
        'postgres',
      ).map((slot) => slot.key),
    ).toEqual(['n:real'])
  })

  it('does not prompt for T-SQL variables declared by the statement', () => {
    const sql =
      'DECLARE @email nvarchar(255), @team int;\nSET @email = :fallback;\nSELECT @email, @team'
    expect(scanParams(sql, 'mssql').map((slot) => slot.key)).toEqual(['n:fallback'])
  })

  it('handles multiline T-SQL declarations and never binds system variables', () => {
    const sql =
      'DECLARE @email nvarchar(255),\n        @team int;\nSELECT @email, @team, @@VERSION, @@ROWCOUNT, @external'
    expect(scanParams(sql, 'mssql').map((slot) => slot.key)).toEqual(['n:external'])
  })

  it('does not mistake declaration text inside a literal or comment for T-SQL code', () => {
    const sql = "SELECT 'DECLARE @email text', @email -- SET @team = 1\n, @team"
    expect(scanParams(sql, 'mssql').map((slot) => slot.key)).toEqual(['n:email', 'n:team'])
  })

  it('keeps literal masking aligned when the SQL contains astral characters', () => {
    // The mask must stay index-aligned with the ORIGINAL string. Code-point iteration
    // silently shortens it by one slot per surrogate pair, so every offset after an
    // emoji drifts left and blanking lands on real code — here it ate the DECLARE,
    // turning a T-SQL local variable into a bind slot and emitting invalid SQL.
    const sql = "SELECT '🙂🙂🙂🙂🙂🙂🙂🙂';\nDECLARE @x INT;\nSELECT * FROM t WHERE a = @x"
    expect(scanParams(sql, 'mssql').map((slot) => slot.key)).toEqual([])

    const compiled = compileSql(sql, 'mssql', {})
    expect(compiled.text).toBe(sql)
    expect(compiled.params).toEqual([])
  })

  it('skips PostgreSQL question-mark operators without losing expression placeholders', () => {
    expect(
      scanParams(
        `SELECT data ?| ARRAY['x'], data ?& ARRAY['y'], data ? 'key', "payload" ? :key, ?? FROM t WHERE id = ?`,
        'postgres',
      ).map((slot) => slot.key),
    ).toEqual(['n:key', 'p:0'])
    expect(
      scanParams('SELECT ?, CASE WHEN ? THEN ? ELSE ? END, coalesce(NULL, ?)', 'postgres').map(
        (slot) => slot.key,
      ),
    ).toEqual(['p:0', 'p:1', 'p:2', 'p:3', 'p:4'])
  })

  it('does not round huge numbered placeholders into the same parameter identity', () => {
    expect(
      scanParams('SELECT $9007199254740992, $9007199254740993, :valid', 'postgres').map(
        (slot) => slot.key,
      ),
    ).toEqual(['n:valid'])
    expect(
      scanParams('SELECT ?9007199254740992, ?9007199254740993, :valid', 'sqlite').map(
        (slot) => slot.key,
      ),
    ).toEqual(['n:valid'])
    expect(compileSql('SELECT $9007199254740992, :valid', 'postgres', { 'n:valid': 1 })).toEqual({
      text: 'SELECT $9007199254740992, $1',
      params: [1],
    })
  })

  it('still skips the existing multi-character question operators', () => {
    expect(
      scanParams("SELECT data ?| ARRAY['x'], data ?& ARRAY['y'], ?? FROM t", 'postgres'),
    ).toHaveLength(0)
  })

  it('uses the selected dialect grammar instead of one universal quote/comment scanner', () => {
    expect(scanParams('SELECT [?, ?]', 'clickhouse').map((slot) => slot.key)).toEqual([
      'p:0',
      'p:1',
    ])
    expect(scanParams('SELECT [?, ?]', 'mssql')).toHaveLength(0)

    expect(scanParams('SELECT 1--2, ?', 'mysql').map((slot) => slot.key)).toEqual(['p:0'])
    expect(scanParams('SELECT /*! :version */ :tail', 'mysql').map((slot) => slot.key)).toEqual([
      'n:version',
      'n:tail',
    ])
    expect(scanParams('SELECT # :hidden\n :real', 'mysql').map((slot) => slot.key)).toEqual([
      'n:real',
    ])
  })

  it('handles PostgreSQL escape strings and nested comments without hiding or inventing binds', () => {
    expect(
      scanParams(String.raw`SELECT E'it\'s :hidden', :real`, 'postgres').map((slot) => slot.key),
    ).toEqual(['n:real'])
    expect(
      scanParams(String.raw`SELECT 'closed\'; :real`, 'postgres').map((slot) => slot.key),
    ).toEqual(['n:real'])
    expect(
      scanParams('SELECT 1 /* outer /* :hidden */ still hidden */ + :real', 'postgres').map(
        (slot) => slot.key,
      ),
    ).toEqual(['n:real'])
  })
})

describe('describeParams', () => {
  it('deduplicates repeated named and numbered values while preserving first use', () => {
    const descriptor = describeParams('WHERE a = :id AND b = $2 AND c = :id AND d = $2', 'postgres')
    expect(descriptor.fields).toEqual([
      { kind: 'named', key: 'n:id', label: ':id' },
      { kind: 'positional', key: 'p:1', label: '$2' },
    ])
    expect(descriptor.any).toBe(true)
  })

  it('is empty for a parameter-free query', () => {
    expect(describeParams('SELECT 1', 'sqlite')).toEqual({ fields: [], any: false })
  })
})

describe('compileSql', () => {
  it('rewrites every accepted spelling to question binds and orders values by occurrence', () => {
    const { text, params } = compileSql(
      'WHERE a = :id AND b = ? AND c = :id AND d = @team',
      'sqlite',
      {
        [paramKey('named', 'id')]: 7,
        [paramKey('positional', 0)]: 'x',
        [paramKey('named', 'team')]: 'core',
      },
    )
    expect(text).toBe('WHERE a = ? AND b = ? AND c = ? AND d = ?')
    expect(params).toEqual([7, 'x', 7, 'core'])
  })

  it('rewrites portable and native postgres tokens to a fresh numbered bind sequence', () => {
    const { text, params } = compileSql(
      'WHERE a = :id AND b = $2 AND c = :id AND d = $2',
      'postgres',
      {
        [paramKey('named', 'id')]: 7,
        [paramKey('positional', 1)]: 'x',
      },
    )
    expect(text).toBe('WHERE a = $1 AND b = $2 AND c = $3 AND d = $4')
    expect(params).toEqual([7, 'x', 7, 'x'])
  })

  it('reserves numbered positions before assigning anonymous placeholders', () => {
    const sql = 'SELECT ?2, ?, ?1, ?, ?2'
    expect(scanParams(sql, 'sqlite').map((slot) => slot.key)).toEqual([
      'p:1',
      'p:2',
      'p:0',
      'p:3',
      'p:1',
    ])
    expect(
      compileSql(sql, 'sqlite', {
        'p:0': 'zero',
        'p:1': 'one',
        'p:2': 'two',
        'p:3': 'three',
      }),
    ).toEqual({
      text: 'SELECT ?, ?, ?, ?, ?',
      params: ['one', 'two', 'zero', 'three', 'one'],
    })
  })

  it('leaves a parameter-free query untouched', () => {
    expect(compileSql('SELECT 1', 'sqlite', {})).toEqual({ text: 'SELECT 1', params: [] })
  })
})

describe('typeParamValue', () => {
  it('binds an exact NULL (any case) as SQL null', () => {
    expect(typeParamValue('NULL')).toBeNull()
    expect(typeParamValue(' null ')).toBeNull()
  })

  it('binds exact numbers as numbers and keeps ambiguous or lossy values as strings', () => {
    expect(typeParamValue('42')).toBe(42)
    expect(typeParamValue('-3.5')).toBe(-3.5)
    expect(typeParamValue('007')).toBe('007')
    expect(typeParamValue('9007199254740993')).toBe('9007199254740993')
    expect(typeParamValue('12345678901234567890.123456789')).toBe('12345678901234567890.123456789')
  })

  it('keeps everything else, including empty input, as text', () => {
    expect(typeParamValue('')).toBe('')
    expect(typeParamValue('ada')).toBe('ada')
    expect(typeParamValue('NULLABLE')).toBe('NULLABLE')
  })
})
