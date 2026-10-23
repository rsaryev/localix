import { expect, test } from 'bun:test'
import { mysqlTableSchema } from './mysql-introspect'
import type { RowsExecutor } from './fk-rows'

const variables = ['SQL_MODE', 'CHARACTER_SET_CLIENT', 'COLLATION_CONNECTION'] as const
const invalidSettings = variables.flatMap((variable) =>
  ["value'; SELECT 1; --", 'value with spaces', 'value; SET x=1'].map((value) => ({
    variable,
    value,
  })),
)

test.each(invalidSettings)(
  'omits invalid trigger setting $variable=$value while preserving valid settings',
  async ({ variable, value }) => {
    const trigger = {
      TRIGGER_NAME: 'audit',
      EVENT_MANIPULATION: 'INSERT',
      ACTION_TIMING: 'AFTER',
      ACTION_STATEMENT: 'SET @audit = 1',
      ACTION_ORDER: 1,
      SQL_MODE: 'ANSI',
      CHARACTER_SET_CLIENT: 'utf8mb4',
      COLLATION_CONNECTION: 'utf8mb4_unicode_ci',
      [variable]: value,
    }
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> =>
      sql.includes('information_schema.triggers') ? ([trigger] as T[]) : []
    const schema = await mysqlTableSchema(rows, 'app', 'items')
    const result = schema.triggers?.[0]
    expect(result?.name).toBe('audit')
    expect(result?.preCreateScripts).toHaveLength(2)
    expect(result?.postCreateScripts).toHaveLength(2)
    const pre = result!.preCreateScripts!.join('\n')
    const post = result!.postCreateScripts!.join('\n')
    expect(pre).not.toContain(value)
    expect(pre).not.toContain(`@@SESSION.${variable}`)
    expect(post).not.toContain(`@@SESSION.${variable}`)
    for (const valid of variables.filter((entry) => entry !== variable)) {
      expect(pre).toContain(`@@SESSION.${valid}`)
      expect(post).toContain(`@@SESSION.${valid}`)
    }
  },
)
