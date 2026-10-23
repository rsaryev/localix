import { describe, expect, it } from 'bun:test'
import { formatSql } from './formatSql'

describe('formatSql', () => {
  it('uppercases keywords and breaks major clauses onto their own lines', () => {
    expect(formatSql('select id, name from users where id = 1 order by name')).toBe(
      'SELECT id, name\nFROM users\nWHERE id = 1\nORDER BY name',
    )
  })

  it('normalizes messy whitespace and comma/paren spacing', () => {
    expect(formatSql('select   count( * )  from    users')).toBe('SELECT COUNT(*)\nFROM users')
    expect(formatSql('select a ,b , c from t')).toBe('SELECT a, b, c\nFROM t')
  })

  it('keeps qualified stars and dotted names tight', () => {
    expect(formatSql('select u.* from users u')).toBe('SELECT u.*\nFROM users u')
    expect(formatSql('select u.id from users u')).toBe('SELECT u.id\nFROM users u')
  })

  it('never rewrites string-literal contents (even keywords/semicolons inside)', () => {
    expect(formatSql("select 'from where; select' as x")).toBe("SELECT 'from where; select' AS x")
  })

  it('breaks after a line comment so the next token is not swallowed', () => {
    const out = formatSql('select a -- pick a\n, b from t')
    // The token after `-- pick a` must be on a new line.
    expect(out.includes('-- pick a\n')).toBe(true)
    expect(out).toContain('FROM t')
  })

  it('does not break GROUP/ORDER unless followed by BY (avoids false positives)', () => {
    // `order` here is a column name, not ORDER BY — still uppercased (keyword set) but not broken.
    expect(formatSql('select order from t')).toBe('SELECT ORDER\nFROM t')
    expect(formatSql('select 1 group by x')).toBe('SELECT 1\nGROUP BY x')
  })

  it('separates statements with a blank line', () => {
    expect(formatSql('select 1; select 2')).toBe('SELECT 1;\n\nSELECT 2')
  })

  it('keeps a space between a clause keyword and its paren (VALUES/IN), but glues function calls', () => {
    expect(formatSql('insert into `t` (a) values (1)')).toBe('INSERT INTO `t` (a)\nVALUES (1)')
    expect(formatSql('select count(*) from t where id in (1,2)')).toBe(
      'SELECT COUNT(*)\nFROM t\nWHERE id IN (1, 2)',
    )
  })

  it('breaks each JOIN (and join run) onto its own line, once', () => {
    expect(
      formatSql('select * from a join b on a.id = b.a_id left outer join c on c.b_id = b.id'),
    ).toBe('SELECT *\nFROM a\nJOIN b ON a.id = b.a_id\nLEFT OUTER JOIN c ON c.b_id = b.id')
  })

  it('keeps multi-char operators intact (does not split <= >= <> != || ::)', () => {
    expect(formatSql('select * from t where a <= 5 and b <> 3')).toBe(
      'SELECT *\nFROM t\nWHERE a <= 5 AND b <> 3',
    )
    expect(formatSql('select a || b, id::text from t')).toBe('SELECT a || b, id::text\nFROM t')
    expect(formatSql("select data->>'k' from t")).toBe("SELECT data->>'k'\nFROM t")
  })

  it('keeps a string-literal prefix glued to its quote (E/N/X/B)', () => {
    expect(formatSql("select E'a' from t")).toBe("SELECT E'a'\nFROM t")
    expect(formatSql("select * from t where a = N'x'")).toContain("N'x'")
    expect(formatSql("select X'ff'")).toBe("SELECT X'ff'")
  })

  it('keeps a dollar-quoted body verbatim (uppercases only outside it)', () => {
    const out = formatSql(
      'create function f() returns int as $$ begin return 1; end $$ language plpgsql',
    )
    // The body is emitted verbatim (no reflow / no keyword-casing / no clause breaks inside).
    expect(out).toContain('$$ begin return 1; end $$')
    expect(out).toContain('CREATE ') // keywords outside the body are still uppercased
    expect(out).not.toContain('\n') // no clause break was injected from inside the body
  })

  it('handles GROUP BY + HAVING + LIMIT', () => {
    expect(formatSql('select x, count(*) from t group by x having count(*) > 1 limit 10')).toBe(
      'SELECT x, COUNT(*)\nFROM t\nGROUP BY x\nHAVING COUNT(*) > 1\nLIMIT 10',
    )
  })

  it('formats a compact CREATE TABLE as an indented structural list', () => {
    expect(
      formatSql(
        "create table users (id integer primary key, name text not null, email text unique, created_at text not null default (datetime('now')))",
      ),
    ).toBe(
      [
        'CREATE TABLE users (',
        '  id integer PRIMARY KEY,',
        '  name text NOT NULL,',
        '  email text UNIQUE,',
        "  created_at text NOT NULL DEFAULT (datetime('now'))",
        ')',
      ].join('\n'),
    )
  })

  it('keeps nested type and constraint commas inline while splitting definitions', () => {
    expect(
      formatSql(
        'CREATE TABLE orders (amount decimal(10,2), pair text, CONSTRAINT pair_unique UNIQUE (amount,pair));',
      ),
    ).toBe(
      [
        'CREATE TABLE orders (',
        '  amount decimal(10, 2),',
        '  pair text,',
        '  CONSTRAINT pair_unique UNIQUE (amount, pair)',
        ');',
      ].join('\n'),
    )
  })

  it('preserves SQL Server bracket identifiers while formatting DDL', () => {
    expect(formatSql('create table [user data] ([user id] int primary key, [name] text)')).toBe(
      ['CREATE TABLE [user data] (', '  [user id] int PRIMARY KEY,', '  [name] text', ')'].join(
        '\n',
      ),
    )
  })
})
