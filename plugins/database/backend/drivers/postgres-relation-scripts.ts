import { quoteIdent as quoteSqlIdent } from '../sql-ident'
import type { readPgTableCatalog } from './postgres-table-queries'

type PgTableCatalog = Awaited<ReturnType<typeof readPgTableCatalog>>

export function postgresRelationScripts(
  sch: string,
  table: string,
  relationRow: PgTableCatalog['statRows'][number] | undefined,
  definitionRow: PgTableCatalog['definitionRows'][number] | undefined,
  triggerRows: PgTableCatalog['triggerRows'],
  ruleRows: PgTableCatalog['ruleRows'],
) {
  const definition = definitionRow?.definition?.trim().replace(/;+\s*$/, '')
  const quoteIdent = (name: string) => quoteSqlIdent(name, 'postgres')
  const temporaryRelation = relationRow?.persistence === 't'
  const relationName = temporaryRelation
    ? quoteIdent(table)
    : `${quoteIdent(sch)}.${quoteIdent(table)}`
  const alterRelation = relationRow?.relkind === 'f' ? 'ALTER FOREIGN TABLE' : 'ALTER TABLE'
  const triggers = triggerRows.flatMap((trigger) => {
    const createScript = trigger.create_script.trim()
    if (!createScript) return []
    const stateAction =
      trigger.enabled_state === 'D'
        ? 'DISABLE'
        : trigger.enabled_state === 'R'
          ? 'ENABLE REPLICA'
          : trigger.enabled_state === 'A'
            ? 'ENABLE ALWAYS'
            : undefined
    return [
      {
        name: trigger.trigger_name,
        createScript,
        ...(stateAction
          ? {
              postCreateScripts: [
                `${alterRelation} ONLY ${relationName} ${stateAction} TRIGGER ${quoteIdent(trigger.trigger_name)}`,
              ],
            }
          : {}),
      },
    ]
  })
  const rules = ruleRows.flatMap((rule) => {
    const createScript = rule.create_script?.trim()
    if (!createScript) return []
    const stateAction =
      rule.enabled_state === 'D'
        ? 'DISABLE'
        : rule.enabled_state === 'R'
          ? 'ENABLE REPLICA'
          : rule.enabled_state === 'A'
            ? 'ENABLE ALWAYS'
            : undefined
    return [
      {
        name: rule.rule_name,
        createScript,
        ...(stateAction
          ? {
              postCreateScripts: [
                `${alterRelation} ONLY ${relationName} ${stateAction} RULE ${quoteIdent(rule.rule_name)}`,
              ],
            }
          : {}),
      },
    ]
  })
  const relationOptions = definitionRow?.reloptions ? ` WITH (${definitionRow.reloptions})` : ''
  const populationClause =
    definitionRow?.relkind === 'm' && !definitionRow.relispopulated ? '\nWITH NO DATA' : ''
  const createViewPrefix =
    definitionRow?.relkind === 'm'
      ? 'CREATE MATERIALIZED VIEW'
      : `CREATE${temporaryRelation ? ' TEMPORARY' : ''} VIEW`
  const createViewTarget =
    temporaryRelation && definitionRow?.relkind === 'm'
      ? `pg_temp.${quoteIdent(table)}`
      : relationName
  const createScript = definition
    ? `${createViewPrefix} ${createViewTarget}${relationOptions} AS\n${definition}${populationClause};`
    : undefined

  return { triggers, rules, createScript }
}
