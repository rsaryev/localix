import { describe, expect, it } from 'bun:test'
import type { DbSchemaItem, DbSchemas } from './port'
import type { RowsExecutor } from './fk-rows'
import { pgSchemas, pgTableSchema } from './postgres-introspect'

describe('pgSchemas', () => {
  it('keeps prototype-named schemas as ordinary own groups', async () => {
    const schemas = await pgSchemas(async <T>(text: string) => {
      expect(text).toContain("c.relkind = 'm'")
      expect(text).toContain('has_table_privilege')
      expect(text).toContain('has_any_column_privilege')
      return [
        { table_schema: '__proto__', table_name: 'events', table_type: 'BASE TABLE' },
        { table_schema: 'constructor', table_name: 'audit', table_type: 'VIEW' },
        {
          table_schema: 'analytics',
          table_name: 'daily_rollup',
          table_type: 'MATERIALIZED VIEW',
        },
      ] as T[]
    })

    expect(Object.getPrototypeOf(schemas)).toBe(Object.prototype)
    expect(Object.hasOwn(schemas, '__proto__')).toBe(true)
    // Annotated, not a bare literal: with no contextual type TS checks the `constructor` key
    // against `Object.prototype.constructor` (a Function) and rejects an array. `DbSchemas` has a
    // string index signature, under which a namespace named `constructor` — the whole point of
    // this test — is perfectly ordinary, and the annotation also pins `type` to `DbObjectType`
    // instead of letting it widen to `string`.
    const expected: DbSchemas = {
      ['__proto__']: [{ name: 'events', type: 'table' }],
      // Only this key needs its own annotation: TS does not apply the index signature when
      // contextually typing a literal's `constructor` property, so without it `type` widens from
      // `'view'` to `string` and no longer fits `DbObjectType`.
      constructor: [{ name: 'audit', type: 'view' }] satisfies DbSchemaItem[],
      analytics: [{ name: 'daily_rollup', type: 'view' }],
    }
    expect(schemas).toEqual(expected)
  })
})

describe('pgTableSchema', () => {
  it('starts independent catalog reads concurrently and assembles their result', async () => {
    let started = 0
    let releaseCatalogReads = () => {}
    const catalogReadsMayFinish = new Promise<void>((resolve) => {
      releaseCatalogReads = resolve
    })
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      started += 1
      await catalogReadsMayFinish

      if (text.includes('information_schema.columns')) {
        expect(text).toContain('format_type(a.atttypid, a.atttypmod)')
        expect(text).toContain('pg_catalog.col_description(a.attrelid, a.attnum) AS comment')
        expect(text).toContain("t.relkind = 'm'")
        expect(text).toContain('has_column_privilege')
        return [
          {
            column_name: 'id',
            data_type: 'uuid',
            comment: 'Stable item identifier',
            is_nullable: 'NO',
            column_default: 'gen_random_uuid()',
          },
          {
            column_name: 'org_id',
            data_type: 'character varying(255)[]',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes("WHERE con.contype IN ('p', 'u')")) {
        expect(text).toContain('JOIN pg_catalog.pg_index')
        expect(text).toContain('unnest(idx.indkey)')
        expect(text).toContain('ns.nspname = $1 AND cls.relname = $2')
        expect(text).toContain("to_jsonb(idx)->>'indnullsnotdistinct'")
        expect(text).toContain("to_jsonb(con)->>'conperiod'")
        expect(text).toContain("to_jsonb(con)->>'conparentid'")
        expect(text).toContain('ORDER BY con.oid, key_col.ord')
        return [
          {
            constraint_name: 'items_pkey',
            constraint_type: 'p',
            column_name: 'id',
            ord: 1,
            is_included: false,
            is_deferrable: false,
            initially_deferred: false,
            nulls_not_distinct: false,
            without_overlaps: false,
          },
          {
            constraint_name: 'items_org_id_key',
            constraint_type: 'u',
            column_name: 'org_id',
            ord: 1,
            is_included: false,
            is_deferrable: true,
            initially_deferred: true,
            nulls_not_distinct: true,
            without_overlaps: false,
          },
          {
            constraint_name: 'items_org_id_key',
            constraint_type: 'u',
            column_name: 'id',
            ord: 2,
            is_included: true,
            is_deferrable: true,
            initially_deferred: true,
            nulls_not_distinct: true,
            without_overlaps: false,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_constraint con')) {
        expect(text).toContain('unnest(con.conkey, con.confkey)')
        expect(text).toContain('con.conname AS constraint_name')
        expect(text).toContain('con.confupdtype AS update_action')
        expect(text).toContain('con.confdeltype AS delete_action')
        expect(text).toContain('con.confmatchtype AS match_type')
        expect(text).toContain('con.condeferrable AS is_deferrable')
        expect(text).toContain('con.convalidated AS is_validated')
        expect(text).toContain("to_jsonb(con)->'confdelsetcols'")
        expect(text).toContain("to_jsonb(con)->>'conperiod'")
        expect(text).toContain("to_jsonb(con)->>'conenforced'")
        expect(text).toContain("to_jsonb(con)->>'conparentid'")
        expect(text).toContain('src_att.attnum = key_pair.src_attnum')
        expect(text).toContain('ref_att.attnum = key_pair.ref_attnum')
        expect(text).toContain('ORDER BY con.oid, key_pair.ord')
        return [
          {
            constraint_name: 'items_org_id_fkey',
            column_name: 'org_id',
            ref_schema: 'public',
            ref_table: 'organisations',
            ref_column: 'id',
            update_action: 'c',
            delete_action: 'n',
            match_type: 'f',
            is_deferrable: true,
            initially_deferred: true,
            is_validated: false,
            delete_action_columns: ['org_id'],
            is_period: false,
            is_enforced: false,
          },
        ] as T[]
      }
      if (text.includes("check_constraint.contype IN ('c', 'x', 'n')")) {
        expect(text).toContain('pg_catalog.pg_get_expr')
        expect(text).toContain('pg_catalog.pg_get_constraintdef')
        expect(text).toContain('check_constraint.convalidated AS is_validated')
        expect(text).toContain('check_constraint.connoinherit AS no_inherit')
        expect(text).toContain("to_jsonb(check_constraint)->>'conenforced'")
        expect(text).toContain("to_jsonb(check_constraint)->>'conparentid'")
        return [
          {
            constraint_type: 'c',
            constraint_name: 'items_score_check',
            expression: 'score >= 0',
            exclusion_definition: null,
            is_validated: false,
            no_inherit: true,
            is_enforced: false,
          },
          {
            constraint_type: 'x',
            constraint_name: 'items_room_during_excl',
            expression: null,
            exclusion_definition:
              'EXCLUDE USING gist (room WITH =, during WITH &&) WHERE (cancelled_at IS NULL) DEFERRABLE',
            is_validated: true,
            no_inherit: false,
            is_enforced: true,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_trigger trigger_catalog')) {
        expect(text).toContain('pg_catalog.pg_get_triggerdef(trigger_catalog.oid, false)')
        expect(text).toContain('NOT trigger_catalog.tgisinternal')
        expect(text).toContain("to_jsonb(trigger_catalog)->>'tgparentid'")
        return [
          {
            trigger_name: 'items_audit',
            create_script:
              'CREATE TRIGGER items_audit AFTER INSERT ON public.items ' +
              'FOR EACH ROW EXECUTE FUNCTION public.audit_item()',
            enabled_state: 'A',
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_rewrite rewrite_rule')) return [] as T[]
      if (text.includes('sequence_table.relacl')) {
        expect(text).toContain("sequence_table.relkind = 'S'")
        expect(text).toContain("ownership.deptype IN ('a', 'i')")
        return [] as T[]
      }
      if (text.includes('pg_catalog.aclexplode')) {
        expect(text).toContain('access_table.relacl IS NOT NULL')
        expect(text).toContain('access_column.attacl IS NOT NULL')
        expect(text).toContain('privilege.grantee = 0 AS is_public')
        return [
          {
            column_name: null,
            grantor: 'data owner',
            grantee: 'reader',
            is_public: false,
            privilege_type: 'SELECT',
            is_grantable: false,
          },
          {
            column_name: null,
            grantor: 'data owner',
            grantee: null,
            is_public: true,
            privilege_type: 'INSERT',
            is_grantable: false,
          },
          {
            column_name: 'org_id',
            grantor: 'data owner',
            grantee: 'reader',
            is_public: false,
            privilege_type: 'UPDATE',
            is_grantable: true,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_class t')) {
        expect(text).toContain('LEFT JOIN pg_attribute')
        expect(text).toContain('k.ord > ix.indnkeyatts AS is_included')
        expect(text).toContain('ix.indisvalid')
        expect(text).toContain('ix.indislive')
        expect(text).toContain("to_jsonb(i)->>'relispartition'")
        expect(text).toContain('pg_get_indexdef(ix.indexrelid)')
        expect(text).toContain('pg_get_indexdef(ix.indexrelid, k.ord::integer, false)')
        expect(text).not.toContain('ix.indexprs IS NULL')
        expect(text).not.toContain('ix.indpred IS NULL')
        return [
          {
            index_name: 'items_pkey',
            column_name: 'id',
            column_definition: 'id',
            ord: '1',
            is_unique: true,
            is_primary: true,
            is_constraint: true,
            is_included: false,
            create_script_only: false,
            create_script: 'CREATE UNIQUE INDEX items_pkey ON public.items USING btree (id)',
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        expect(text).toContain("pg_catalog.obj_description(c.oid, 'pg_class')")
        return [
          {
            reltuples: '42',
            relkind: 'v',
            relation_comment: 'Visible items',
            owner_name: 'data owner',
            acl_explicit: true,
          },
        ] as T[]
      }
      if (text.includes('pg_get_viewdef')) {
        expect(text).toContain("pg_has_role(c.relowner, 'USAGE')")
        return [
          {
            definition: ' SELECT id, org_id FROM public.source_items; ',
            relkind: 'v',
            reloptions: 'security_barrier=true',
            relispopulated: true,
          },
        ] as T[]
      }
      return [] as T[]
    }

    const schemaPromise = pgTableSchema(rows, 'public', 'items')
    await Promise.resolve()
    try {
      expect(started).toBe(13)
    } finally {
      releaseCatalogReads()
    }

    const schema = await schemaPromise
    expect(schema).toMatchObject({
      schema: 'public',
      name: 'items',
      type: 'view',
      comment: 'Visible items',
      postgresAccess: {
        owner: 'data owner',
        tableGrants: [
          {
            grantor: 'data owner',
            grantee: 'reader',
            privilege: 'SELECT',
            grantable: false,
          },
          {
            grantor: 'data owner',
            privilege: 'INSERT',
            grantable: false,
          },
        ],
        columnGrants: [
          {
            column: 'org_id',
            grants: [
              {
                grantor: 'data owner',
                grantee: 'reader',
                privilege: 'UPDATE',
                grantable: true,
              },
            ],
          },
        ],
      },
      primaryKey: ['id'],
      approxRows: 42,
      columns: [
        { name: 'id', dataType: 'uuid', pk: true, comment: 'Stable item identifier' },
        {
          name: 'org_id',
          dataType: 'character varying(255)[]',
          pk: false,
          nullable: true,
        },
      ],
      foreignKeys: [
        {
          name: 'items_org_id_fkey',
          columns: ['org_id'],
          refSchema: 'public',
          refTable: 'organisations',
          refColumns: ['id'],
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
          match: 'FULL',
          deferrable: true,
          initiallyDeferred: true,
          validated: false,
          onDeleteColumns: ['org_id'],
          enforced: false,
        },
      ],
      checkConstraints: [
        {
          name: 'items_score_check',
          expression: 'score >= 0',
          validated: false,
          noInherit: true,
          enforced: false,
        },
      ],
      keyConstraints: [
        {
          name: 'items_pkey',
          type: 'PRIMARY KEY',
          columns: ['id'],
        },
        {
          name: 'items_org_id_key',
          type: 'UNIQUE',
          columns: ['org_id'],
          includeColumns: ['id'],
          nullsNotDistinct: true,
          deferrable: true,
          initiallyDeferred: true,
        },
      ],
      exclusionConstraints: [
        {
          name: 'items_room_during_excl',
          definition:
            'EXCLUDE USING gist (room WITH =, during WITH &&) WHERE (cancelled_at IS NULL) DEFERRABLE',
        },
      ],
      indexes: [
        {
          name: 'items_pkey',
          columns: ['id'],
          unique: true,
          primary: true,
          constraint: true,
          createScript: 'CREATE UNIQUE INDEX items_pkey ON public.items USING btree (id)',
        },
      ],
      triggers: [
        {
          name: 'items_audit',
          createScript:
            'CREATE TRIGGER items_audit AFTER INSERT ON public.items ' +
            'FOR EACH ROW EXECUTE FUNCTION public.audit_item()',
          postCreateScripts: [
            'ALTER TABLE ONLY "public"."items" ENABLE ALWAYS TRIGGER "items_audit"',
          ],
        },
      ],
      createScript:
        'CREATE VIEW "public"."items" WITH (security_barrier=true) AS\nSELECT id, org_id FROM public.source_items;',
    })
  })

  it('preserves expression and partial indexes through native catalog DDL', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('FROM pg_class t'))
        return [
          {
            index_name: 'items_active_email_idx',
            column_name: null,
            column_definition: 'lower(email)',
            ord: '1',
            is_unique: true,
            is_primary: false,
            is_constraint: false,
            is_included: false,
            create_script_only: true,
            create_script:
              'CREATE UNIQUE INDEX items_active_email_idx ON public.items ' +
              'USING btree (lower(email)) INCLUDE (id) WHERE (deleted_at IS NULL)',
          },
          {
            index_name: 'items_active_email_idx',
            column_name: 'id',
            column_definition: 'id',
            ord: '2',
            is_unique: true,
            is_primary: false,
            is_constraint: false,
            is_included: true,
            create_script_only: true,
            create_script:
              'CREATE UNIQUE INDEX items_active_email_idx ON public.items ' +
              'USING btree (lower(email)) INCLUDE (id) WHERE (deleted_at IS NULL)',
          },
        ] as T[]
      if (text.includes('reltuples::bigint')) return [{ reltuples: '4', relkind: 'r' }] as T[]
      return [] as T[]
    }

    const schema = await pgTableSchema(rows, 'public', 'items')

    expect(schema.indexes).toEqual([
      {
        name: 'items_active_email_idx',
        columns: ['lower(email)'],
        includeColumns: ['id'],
        unique: true,
        primary: false,
        createScriptOnly: true,
        createScript:
          'CREATE UNIQUE INDEX items_active_email_idx ON public.items ' +
          'USING btree (lower(email)) INCLUDE (id) WHERE (deleted_at IS NULL)',
      },
    ])
  })

  it('distinguishes PostgreSQL default ACLs from an explicit empty table ACL', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns'))
        return [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      if (text.includes('pg_catalog.aclexplode'))
        return [
          {
            column_name: null,
            grantor: null,
            grantee: null,
            is_public: null,
            privilege_type: null,
            is_grantable: null,
          },
        ] as T[]
      if (text.includes('reltuples::bigint'))
        return [
          {
            reltuples: '0',
            relkind: 'r',
            owner_name: 'locked owner',
            acl_explicit: true,
          },
        ] as T[]
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'public', 'locked')).toMatchObject({
      postgresAccess: {
        owner: 'locked owner',
        tableGrants: [],
      },
    })
  })

  it('preserves every PostgreSQL trigger firing mode without exporting partition clones', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('FROM pg_catalog.pg_trigger trigger_catalog')) {
        expect(text).toContain('NOT trigger_catalog.tgisinternal')
        expect(text).toContain("to_jsonb(trigger_catalog)->>'tgparentid'")
        return [
          {
            trigger_name: 'origin',
            create_script:
              'CREATE TRIGGER origin AFTER INSERT ON "odd""schema"."event log" ' +
              'EXECUTE FUNCTION audit()',
            enabled_state: 'O',
          },
          {
            trigger_name: 'disabled',
            create_script:
              'CREATE TRIGGER disabled AFTER INSERT ON "odd""schema"."event log" ' +
              'EXECUTE FUNCTION audit()',
            enabled_state: 'D',
          },
          {
            trigger_name: 'replica',
            create_script:
              'CREATE TRIGGER replica AFTER INSERT ON "odd""schema"."event log" ' +
              'EXECUTE FUNCTION audit()',
            enabled_state: 'R',
          },
          {
            trigger_name: 'audit"all',
            create_script:
              'CREATE TRIGGER "audit""all" AFTER INSERT ON "odd""schema"."event log" ' +
              'EXECUTE FUNCTION audit()',
            enabled_state: 'A',
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) return [{ reltuples: '4', relkind: 'r' }] as T[]
      return [] as T[]
    }

    expect((await pgTableSchema(rows, 'odd"schema', 'event log')).triggers).toEqual([
      {
        name: 'origin',
        createScript:
          'CREATE TRIGGER origin AFTER INSERT ON "odd""schema"."event log" ' +
          'EXECUTE FUNCTION audit()',
      },
      {
        name: 'disabled',
        createScript:
          'CREATE TRIGGER disabled AFTER INSERT ON "odd""schema"."event log" ' +
          'EXECUTE FUNCTION audit()',
        postCreateScripts: [
          'ALTER TABLE ONLY "odd""schema"."event log" DISABLE TRIGGER "disabled"',
        ],
      },
      {
        name: 'replica',
        createScript:
          'CREATE TRIGGER replica AFTER INSERT ON "odd""schema"."event log" ' +
          'EXECUTE FUNCTION audit()',
        postCreateScripts: [
          'ALTER TABLE ONLY "odd""schema"."event log" ENABLE REPLICA TRIGGER "replica"',
        ],
      },
      {
        name: 'audit"all',
        createScript:
          'CREATE TRIGGER "audit""all" AFTER INSERT ON "odd""schema"."event log" ' +
          'EXECUTE FUNCTION audit()',
        postCreateScripts: [
          'ALTER TABLE ONLY "odd""schema"."event log" ENABLE ALWAYS TRIGGER "audit""all"',
        ],
      },
    ])
  })

  it('preserves PostgreSQL rewrite rules and their firing modes without exporting _RETURN', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('FROM pg_catalog.pg_rewrite rewrite_rule')) {
        expect(text).toContain('pg_catalog.pg_get_ruledef(rewrite_rule.oid, false)')
        expect(text).toContain("rewrite_rule.rulename = '_RETURN'")
        expect(text).toContain("rewrite_rule.ev_type = '1'")
        return [
          {
            rule_name: 'origin',
            create_script:
              'CREATE RULE origin AS ON UPDATE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
            enabled_state: 'O',
          },
          {
            rule_name: 'disabled',
            create_script:
              'CREATE RULE disabled AS ON INSERT TO "odd""schema"."event log" DO INSTEAD NOTHING',
            enabled_state: 'D',
          },
          {
            rule_name: 'replica',
            create_script:
              'CREATE RULE replica AS ON DELETE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
            enabled_state: 'R',
          },
          {
            rule_name: 'audit"all',
            create_script:
              'CREATE RULE "audit""all" AS ON UPDATE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
            enabled_state: 'A',
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) return [{ reltuples: '4', relkind: 'r' }] as T[]
      return [] as T[]
    }

    expect((await pgTableSchema(rows, 'odd"schema', 'event log')).rules).toEqual([
      {
        name: 'origin',
        createScript:
          'CREATE RULE origin AS ON UPDATE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
      },
      {
        name: 'disabled',
        createScript:
          'CREATE RULE disabled AS ON INSERT TO "odd""schema"."event log" DO INSTEAD NOTHING',
        postCreateScripts: ['ALTER TABLE ONLY "odd""schema"."event log" DISABLE RULE "disabled"'],
      },
      {
        name: 'replica',
        createScript:
          'CREATE RULE replica AS ON DELETE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
        postCreateScripts: [
          'ALTER TABLE ONLY "odd""schema"."event log" ENABLE REPLICA RULE "replica"',
        ],
      },
      {
        name: 'audit"all',
        createScript:
          'CREATE RULE "audit""all" AS ON UPDATE TO "odd""schema"."event log" DO ALSO NOTIFY audit',
        postCreateScripts: [
          'ALTER TABLE ONLY "odd""schema"."event log" ENABLE ALWAYS RULE "audit""all"',
        ],
      },
    ])
  })

  it('reads materialized-view columns from pg_catalog', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        expect(text).toContain("t.relkind = 'm'")
        expect(text).toContain('a.attnum > 0 AND NOT a.attisdropped')
        expect(text).toContain('has_column_privilege')
        return [
          {
            column_name: 'bucket',
            data_type: 'timestamp with time zone',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        return [{ reltuples: '8', relkind: 'm' }] as T[]
      }
      if (text.includes('pg_get_viewdef')) {
        return [
          {
            definition: "SELECT date_trunc('day', created_at) AS bucket FROM events;",
            relkind: 'm',
            reloptions: null,
            relispopulated: false,
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'analytics', 'daily_rollup')).toMatchObject({
      schema: 'analytics',
      name: 'daily_rollup',
      type: 'view',
      columns: [
        {
          name: 'bucket',
          dataType: 'timestamp with time zone',
          nullable: true,
          defaultValue: null,
        },
      ],
      approxRows: 8,
      createScript:
        'CREATE MATERIALIZED VIEW "analytics"."daily_rollup" AS\n' +
        "SELECT date_trunc('day', created_at) AS bucket FROM events\n" +
        'WITH NO DATA;',
    })
  })

  it('normalizes physical temp schemas in views and post-create state', async () => {
    const rows: RowsExecutor = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      const relation = typeof params?.[1] === 'string' ? params[1] : ''
      const materialized = relation === 'temp_rollup'
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('pg_get_triggerdef')) {
        return (
          materialized
            ? []
            : [
                {
                  trigger_name: 'disabled_trigger',
                  create_script:
                    'CREATE TRIGGER disabled_trigger INSTEAD OF INSERT ON temp_view FOR EACH ROW EXECUTE FUNCTION temp_trigger()',
                  enabled_state: 'D',
                },
              ]
        ) as T[]
      }
      if (text.includes('pg_get_ruledef')) {
        return (
          materialized
            ? []
            : [
                {
                  rule_name: 'disabled_rule',
                  create_script: 'CREATE RULE disabled_rule AS ON UPDATE TO temp_view DO NOTHING',
                  enabled_state: 'D',
                },
              ]
        ) as T[]
      }
      if (text.includes('reltuples::bigint')) {
        return [
          {
            reltuples: '0',
            relkind: materialized ? 'm' : 'v',
            persistence: 't',
          },
        ] as T[]
      }
      if (text.includes('pg_get_viewdef')) {
        return [
          {
            definition: 'SELECT 1 AS id;',
            relkind: materialized ? 'm' : 'v',
            reloptions: null,
            relispopulated: !materialized,
          },
        ] as T[]
      }
      return [] as T[]
    }

    const view = await pgTableSchema(rows, 'pg_temp_7', 'temp_view')
    expect(view).toMatchObject({
      postgresRelation: { persistence: 'TEMPORARY' },
      createScript: 'CREATE TEMPORARY VIEW "temp_view" AS\nSELECT 1 AS id;',
      triggers: [
        {
          postCreateScripts: ['ALTER TABLE ONLY "temp_view" DISABLE TRIGGER "disabled_trigger"'],
        },
      ],
      rules: [
        {
          postCreateScripts: ['ALTER TABLE ONLY "temp_view" DISABLE RULE "disabled_rule"'],
        },
      ],
    })
    expect(
      [
        view.createScript,
        ...(view.triggers ?? []).flatMap((trigger) => [
          trigger.createScript,
          ...(trigger.postCreateScripts ?? []),
        ]),
        ...(view.rules ?? []).flatMap((rule) => [
          rule.createScript,
          ...(rule.postCreateScripts ?? []),
        ]),
      ].join('\n'),
    ).not.toContain('pg_temp_7')

    expect(await pgTableSchema(rows, 'pg_temp_7', 'temp_rollup')).toMatchObject({
      postgresRelation: { persistence: 'TEMPORARY' },
      createScript:
        'CREATE MATERIALIZED VIEW pg_temp."temp_rollup" AS\nSELECT 1 AS id\nWITH NO DATA;',
    })
  })

  it('preserves identity, generated, and owned-sequence column metadata', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        expect(text).toContain("to_jsonb(a)->>'attidentity'")
        expect(text).toContain("to_jsonb(a)->>'attgenerated'")
        expect(text).toContain('pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)')
        expect(text).toContain('JOIN pg_catalog.pg_sequence')
        expect(text).toContain("dep.deptype IN ('a', 'i')")
        expect(text).toContain("pg_catalog.obj_description(seq_cls.oid, 'pg_class')")
        expect(text).toContain('seq_cls.relacl IS NOT NULL AS sequence_acl_explicit')
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: null,
            generated_kind: '',
            generated_expression: null,
            identity_kind: 'a',
            sequence_schema: 'sales',
            sequence_name: 'orders_id_seq',
            sequence_data_type: 'bigint',
            sequence_start: '10',
            sequence_increment: '5',
            sequence_min: '10',
            sequence_max: '9223372036854775807',
            sequence_cache: '20',
            sequence_cycle: false,
            sequence_unlogged: true,
            sequence_comment: 'Generated order identifiers',
            sequence_owner: 'data owner',
            sequence_acl_explicit: true,
          },
          {
            column_name: 'legacy_id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: "nextval('sales.legacy_seq'::regclass)",
            generated_kind: '',
            generated_expression: null,
            identity_kind: '',
            sequence_schema: 'sales',
            sequence_name: 'legacy_seq',
            sequence_data_type: 'integer',
            sequence_start: '1',
            sequence_increment: '1',
            sequence_min: '1',
            sequence_max: '2147483647',
            sequence_cache: '1',
            sequence_cycle: false,
            sequence_unlogged: false,
            sequence_comment: null,
            sequence_owner: 'data owner',
            sequence_acl_explicit: true,
          },
          {
            column_name: 'total',
            data_type: 'numeric',
            is_nullable: 'YES',
            column_default: null,
            generated_kind: 's',
            generated_expression: '(quantity * unit_price)',
            identity_kind: '',
            sequence_schema: null,
            sequence_name: null,
            sequence_data_type: null,
            sequence_start: null,
            sequence_increment: null,
            sequence_min: null,
            sequence_max: null,
            sequence_cache: null,
            sequence_cycle: null,
            sequence_unlogged: null,
          },
        ] as T[]
      }
      if (text.includes('sequence_table.relacl')) {
        expect(text).toContain("sequence_table.relkind = 'S'")
        expect(text).toContain("ownership.deptype IN ('a', 'i')")
        return [
          {
            sequence_schema: 'sales',
            sequence_name: 'orders_id_seq',
            column_name: null,
            grantor: 'data owner',
            grantee: 'reader',
            is_public: false,
            privilege_type: 'USAGE',
            is_grantable: true,
          },
          {
            sequence_schema: 'sales',
            sequence_name: 'legacy_seq',
            column_name: null,
            grantor: null,
            grantee: null,
            is_public: null,
            privilege_type: null,
            is_grantable: null,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) return [{ reltuples: '12', relkind: 'r' }] as T[]
      return [] as T[]
    }

    expect((await pgTableSchema(rows, 'sales', 'orders')).columns).toEqual([
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        pk: false,
        defaultValue: null,
        identity: {
          generation: 'ALWAYS',
          sequence: {
            schema: 'sales',
            name: 'orders_id_seq',
            dataType: 'bigint',
            start: '10',
            increment: '5',
            minValue: '10',
            maxValue: '9223372036854775807',
            cache: '20',
            cycle: false,
            unlogged: true,
            comment: 'Generated order identifiers',
            postgresAccess: {
              owner: 'data owner',
              grants: [
                {
                  grantor: 'data owner',
                  grantee: 'reader',
                  privilege: 'USAGE',
                  grantable: true,
                },
              ],
            },
          },
        },
      },
      {
        name: 'legacy_id',
        dataType: 'integer',
        nullable: false,
        pk: false,
        defaultValue: "nextval('sales.legacy_seq'::regclass)",
        ownedSequence: {
          schema: 'sales',
          name: 'legacy_seq',
          dataType: 'integer',
          start: '1',
          increment: '1',
          minValue: '1',
          maxValue: '2147483647',
          cache: '1',
          cycle: false,
          postgresAccess: {
            owner: 'data owner',
            grants: [],
          },
        },
      },
      {
        name: 'total',
        dataType: 'numeric',
        nullable: true,
        pk: false,
        defaultValue: null,
        generated: {
          expression: '(quantity * unit_price)',
          storage: 'STORED',
        },
      },
    ])
  })

  it('preserves PostgreSQL column collation, storage, compression, and planner settings', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        expect(text).toContain('a.attcollation <> attribute_type.typcollation')
        expect(text).toContain('a.attstorage <> attribute_type.typstorage')
        expect(text).toContain("to_jsonb(a)->>'attcompression'")
        expect(text).toContain('NULLIF(a.attstattarget, -1) AS statistics_target')
        expect(text).toContain('a.attoptions AS attribute_options')
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            column_name: 'label',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
            collation_schema: 'pg_catalog',
            collation_name: 'C',
            statistics_target: '777',
            attribute_options: ['n_distinct=0.25', 'n_distinct_inherited=0.5'],
          },
          {
            column_name: 'payload',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
            storage_kind: 'EXTERNAL',
            compression_method: 'pglz',
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) return [{ reltuples: '0', relkind: 'r' }] as T[]
      return [] as T[]
    }

    expect((await pgTableSchema(rows, 'inventory', 'assets')).columns).toEqual([
      {
        name: 'id',
        dataType: 'bigint',
        nullable: true,
        pk: false,
        defaultValue: null,
      },
      {
        name: 'label',
        dataType: 'text',
        nullable: true,
        pk: false,
        defaultValue: null,
        postgresCollation: {
          schema: 'pg_catalog',
          name: 'C',
        },
        postgresStatistics: 777,
        postgresAttributeOptions: [
          { name: 'n_distinct', value: '0.25' },
          { name: 'n_distinct_inherited', value: '0.5' },
        ],
      },
      {
        name: 'payload',
        dataType: 'text',
        nullable: true,
        pk: false,
        defaultValue: null,
        postgresStorage: 'EXTERNAL',
        postgresCompression: 'pglz',
      },
    ])
  })

  it('preserves PostgreSQL 18 named and invalid NOT NULL constraints', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'required',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
          },
          {
            column_name: 'pending_validation',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes("check_constraint.contype IN ('c', 'x', 'n')")) {
        expect(text).toContain('constrained_column.attnum = check_constraint.conkey[1]')
        return [
          {
            constraint_type: 'n',
            constraint_name: 'required_not_null',
            column_name: 'required',
            expression: null,
            exclusion_definition: null,
            is_validated: true,
            no_inherit: true,
            is_enforced: true,
            is_inherited: false,
          },
          {
            constraint_type: 'n',
            constraint_name: 'pending_validation_not_null',
            column_name: 'pending_validation',
            expression: null,
            exclusion_definition: null,
            is_validated: false,
            no_inherit: false,
            is_enforced: true,
            is_inherited: false,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) return [{ reltuples: '0', relkind: 'r' }] as T[]
      return [] as T[]
    }

    expect((await pgTableSchema(rows, 'public', 'validated_later')).columns).toEqual([
      {
        name: 'required',
        dataType: 'text',
        nullable: false,
        pk: false,
        defaultValue: null,
        postgresNotNull: {
          name: 'required_not_null',
          validated: true,
          noInherit: true,
        },
      },
      {
        name: 'pending_validation',
        dataType: 'text',
        nullable: false,
        pk: false,
        defaultValue: null,
        postgresNotNull: {
          name: 'pending_validation_not_null',
          validated: false,
        },
      },
    ])
  })

  it('preserves PostgreSQL persistence, access method, storage parameters, and tablespace', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: null,
            identity_kind: 'd',
            sequence_schema: 'archive',
            sequence_name: 'events_id_seq',
            sequence_data_type: 'bigint',
            sequence_start: '1',
            sequence_increment: '1',
            sequence_min: '1',
            sequence_max: '9223372036854775807',
            sequence_cache: '1',
            sequence_cycle: false,
            sequence_unlogged: false,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        expect(text).toContain('c.relpersistence AS persistence')
        expect(text).toContain('relation_access_method.oid = c.relam')
        expect(text).toContain('relation_tablespace.oid = c.reltablespace')
        return [
          {
            reltuples: '3',
            relkind: 'r',
            is_partition: false,
            persistence: 'u',
            access_method: 'heap',
            storage_parameters: ['fillfactor=70', 'autovacuum_enabled=false'],
            tablespace: 'fast space',
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'archive', 'events')).toMatchObject({
      columns: [
        {
          identity: {
            sequence: {
              logged: true,
            },
          },
        },
      ],
      postgresRelation: {
        persistence: 'UNLOGGED',
        accessMethod: 'heap',
        storageParameters: ['fillfactor=70', 'autovacuum_enabled=false'],
        tablespace: 'fast space',
      },
    })
  })

  it('preserves PostgreSQL extended statistics definitions and object state', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'tenant_id',
            data_type: 'integer',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            column_name: 'email',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_statistic_ext statistics_object')) {
        expect(text).toContain('pg_catalog.pg_get_statisticsobjdef(statistics_object.oid)')
        expect(text).toContain("statistics_object.oid, 'pg_statistic_ext'")
        expect(text).toContain('statistics_object.stxstattarget AS statistics_target')
        expect(text).toContain('statistics_object.stxrelid')
        return [
          {
            statistics_schema: 'metrics',
            statistics_name: 'events_tenant_email',
            create_script:
              'CREATE STATISTICS metrics.events_tenant_email (dependencies, mcv) ' +
              'ON tenant_id, lower(email) FROM data.events',
            owner_name: 'stats owner',
            statistics_target: '321',
            comment: "Planner's guide",
          },
          {
            statistics_schema: 'data',
            statistics_name: 'events_expr',
            create_script: 'CREATE STATISTICS data.events_expr ON lower(email) FROM data.events',
            owner_name: 'data owner',
            statistics_target: null,
            comment: null,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        return [{ reltuples: '0', relkind: 'r', persistence: 'p' }] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'data', 'events')).toMatchObject({
      postgresExtendedStatistics: [
        {
          schema: 'metrics',
          name: 'events_tenant_email',
          createScript:
            'CREATE STATISTICS metrics.events_tenant_email (dependencies, mcv) ' +
            'ON tenant_id, lower(email) FROM data.events',
          owner: 'stats owner',
          statisticsTarget: 321,
          comment: "Planner's guide",
        },
        {
          schema: 'data',
          name: 'events_expr',
          createScript: 'CREATE STATISTICS data.events_expr ON lower(email) FROM data.events',
          owner: 'data owner',
        },
      ],
    })
  })

  it('preserves PostgreSQL row-security policies and replica identity', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'tenant_id',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_policy policy')) {
        expect(text).toContain("to_jsonb(policy)->>'polpermissive'")
        expect(text).toContain('unnest(policy.polroles) WITH ORDINALITY')
        expect(text).toContain('pg_catalog.pg_get_userbyid')
        expect(text).toContain('policy.polqual, policy.polrelid')
        expect(text).toContain('policy.polwithcheck, policy.polrelid')
        return [
          {
            policy_name: 'tenant visibility',
            command_kind: 'SELECT',
            permissive: false,
            roles: ['PUBLIC', 'reporting role'],
            using_expression: 'tenant_id = CURRENT_USER',
            check_expression: null,
          },
          {
            policy_name: 'tenant writes',
            command_kind: 'INSERT',
            permissive: true,
            roles: ['writer'],
            using_expression: null,
            check_expression: 'tenant_id = CURRENT_USER',
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        expect(text).toContain("to_jsonb(c)->>'relrowsecurity'")
        expect(text).toContain("to_jsonb(c)->>'relforcerowsecurity'")
        expect(text).toContain("to_jsonb(c)->>'relreplident'")
        expect(text).toContain("to_jsonb(replica_index_catalog)->>'indisreplident'")
        expect(text).toContain("to_jsonb(clustered_index_catalog)->>'indisclustered'")
        return [
          {
            reltuples: '0',
            relkind: 'r',
            row_security: true,
            force_row_security: true,
            replica_identity: 'i',
            replica_identity_index: 'assets_replica_key',
            clustered_index: 'assets_cluster_key',
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'inventory', 'assets')).toMatchObject({
      postgresRowSecurity: {
        enabled: true,
        forced: true,
        policies: [
          {
            name: 'tenant visibility',
            command: 'SELECT',
            permissive: false,
            roles: ['PUBLIC', 'reporting role'],
            using: 'tenant_id = CURRENT_USER',
          },
          {
            name: 'tenant writes',
            command: 'INSERT',
            permissive: true,
            roles: ['writer'],
            withCheck: 'tenant_id = CURRENT_USER',
          },
        ],
      },
      postgresReplicaIdentity: {
        mode: 'INDEX',
        index: 'assets_replica_key',
      },
      postgresClusteredIndex: 'assets_cluster_key',
    })
  })

  it('preserves a PostgreSQL typed-table dependency', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        expect(text).toContain('relation_type.oid = c.reloftype')
        expect(text).toContain('relation_type_schema.oid = relation_type.typnamespace')
        return [
          {
            reltuples: '0',
            relkind: 'r',
            is_partition: false,
            persistence: 'p',
            access_method: 'heap',
            storage_parameters: null,
            tablespace: null,
            of_type_schema: 'inventory',
            of_type_name: 'asset_type',
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'archive', 'assets')).toMatchObject({
      postgresOfType: {
        schema: 'inventory',
        name: 'asset_type',
      },
    })
  })

  it('preserves PostgreSQL foreign-table server and FDW options', async () => {
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: null,
          },
          {
            column_name: 'payload',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('reltuples::bigint')) {
        return [
          {
            reltuples: '-1',
            relkind: 'f',
            is_partition: false,
            persistence: 'p',
            access_method: null,
            storage_parameters: null,
            tablespace: null,
            of_type_schema: null,
            of_type_name: null,
          },
        ] as T[]
      }
      if (text.includes('pg_catalog.pg_foreign_table foreign_table')) {
        expect(text).toContain('foreign_server.oid = foreign_table.ftserver')
        expect(text).toContain("foreign_relation.relkind = 'f'")
        return [
          {
            server_name: 'warehouse server',
            table_options: ['schema_name=inventory', 'table_name=asset=archive'],
          },
        ] as T[]
      }
      if (text.includes('foreign_column.attfdwoptions AS column_options')) {
        expect(text).toContain('ORDER BY foreign_column.attnum')
        return [
          {
            column_name: 'id',
            column_options: ['column_name=asset_id'],
          },
          {
            column_name: 'payload',
            column_options: null,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_trigger trigger_catalog')) {
        return [
          {
            trigger_name: 'assets_audit',
            create_script:
              'CREATE TRIGGER assets_audit AFTER INSERT ON archive.assets FOR EACH ROW EXECUTE FUNCTION audit_asset()',
            enabled_state: 'D',
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'archive', 'assets')).toMatchObject({
      columns: [
        {
          name: 'id',
          postgresForeignOptions: [{ name: 'column_name', value: 'asset_id' }],
        },
        {
          name: 'payload',
        },
      ],
      postgresForeign: {
        server: 'warehouse server',
        options: [
          { name: 'schema_name', value: 'inventory' },
          { name: 'table_name', value: 'asset=archive' },
        ],
      },
      triggers: [
        {
          name: 'assets_audit',
          postCreateScripts: [
            'ALTER FOREIGN TABLE ONLY "archive"."assets" DISABLE TRIGGER "assets_audit"',
          ],
        },
      ],
    })
  })

  it('falls back to basic columns when a compatible server lacks pg_sequence', async () => {
    let columnAttempts = 0
    let partitionReads = 0
    const rows: RowsExecutor = async <T>(text: string): Promise<T[]> => {
      if (text.includes('pg_catalog.pg_get_partkeydef')) partitionReads++
      if (text.includes('information_schema.columns')) {
        columnAttempts++
        if (text.includes('pg_catalog.pg_sequence'))
          throw new Error('relation pg_catalog.pg_sequence does not exist')
        return [
          {
            column_name: 'id',
            data_type: 'integer',
            comment: 'Legacy identifier',
            is_nullable: 'NO',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes('pg_catalog.aclexplode'))
        throw new Error('function pg_catalog.aclexplode does not exist')
      if (text.includes('reltuples::bigint'))
        return [
          {
            reltuples: '1',
            relkind: 'r',
            owner_name: 'legacy owner',
            acl_explicit: true,
          },
        ] as T[]
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'public', 'legacy_table')).toMatchObject({
      columns: [
        {
          name: 'id',
          dataType: 'integer',
          comment: 'Legacy identifier',
          nullable: false,
          defaultValue: null,
        },
      ],
      postgresAccess: {
        owner: 'legacy owner',
      },
    })
    expect(columnAttempts).toBe(2)
    expect(partitionReads).toBe(0)
  })

  it('deparses a partition key only after the catalog identifies a partitioned table', async () => {
    let partitionReads = 0
    const rows: RowsExecutor = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      if (text.includes('reltuples::bigint')) return [{ reltuples: '-1', relkind: 'p' }] as T[]
      if (text.includes('pg_catalog.pg_get_partkeydef')) {
        partitionReads++
        expect(text).toContain("c.relkind = 'p'")
        expect(params).toEqual(['sales', 'orders'])
        return [
          {
            partition_key: 'RANGE (created_at, lower(region) text_pattern_ops)',
          },
        ] as T[]
      }
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'created_at',
            data_type: 'timestamp with time zone',
            is_nullable: 'NO',
            column_default: null,
          },
          {
            column_name: 'region',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'sales', 'orders')).toMatchObject({
      type: 'table',
      approxRows: undefined,
      postgresPartitionBy: 'RANGE (created_at, lower(region) text_pattern_ops)',
    })
    expect(partitionReads).toBe(1)
  })

  it('preserves a child partition bound and only its column overrides', async () => {
    let parentReads = 0
    let overrideReads = 0
    const rows: RowsExecutor = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      if (text.includes('reltuples::bigint'))
        return [{ reltuples: '12', relkind: 'r', is_partition: true }] as T[]
      if (text.includes('child_table.relpartbound')) {
        parentReads++
        expect(text).toContain('JOIN pg_catalog.pg_inherits inheritance')
        expect(text).toContain('child_table.relispartition')
        expect(params).toEqual(['sales', 'orders_2026'])
        return [
          {
            parent_schema: 'sales',
            parent_table: 'orders',
            partition_bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
          },
        ] as T[]
      }
      if (text.includes('child_default.adbin')) {
        overrideReads++
        expect(text).toContain('parent_default.adbin')
        expect(text).toContain('parent_attribute.attnotnull AS parent_not_null')
        expect(params).toEqual(['sales', 'orders_2026'])
        return [
          {
            column_name: 'id',
            child_default: "nextval('sales.orders_id_seq'::regclass)",
            parent_default: "nextval('sales.orders_id_seq'::regclass)",
            child_not_null: true,
            parent_not_null: true,
          },
          {
            column_name: 'region',
            child_default: "'eu'::text",
            parent_default: null,
            child_not_null: true,
            parent_not_null: false,
          },
          {
            column_name: 'obsolete',
            child_default: null,
            parent_default: "'legacy'::text",
            child_not_null: false,
            parent_not_null: false,
          },
        ] as T[]
      }
      if (text.includes('information_schema.columns')) {
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: "nextval('sales.orders_id_seq'::regclass)",
          },
          {
            column_name: 'region',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: "'eu'::text",
          },
          {
            column_name: 'obsolete',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
          },
        ] as T[]
      }
      if (text.includes("WHERE con.contype IN ('p', 'u')")) {
        return [
          {
            constraint_name: 'orders_2026_pkey',
            constraint_type: 'p',
            column_name: 'id',
            ord: 1,
            is_included: false,
            is_deferrable: false,
            initially_deferred: false,
            nulls_not_distinct: false,
            without_overlaps: false,
            is_inherited: true,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_catalog.pg_constraint con')) {
        return [
          {
            constraint_name: 'orders_2026_user_fkey',
            column_name: 'id',
            ref_schema: 'identity',
            ref_table: 'users',
            ref_column: 'id',
            update_action: 'a',
            delete_action: 'a',
            match_type: 's',
            is_deferrable: false,
            initially_deferred: false,
            is_validated: true,
            delete_action_columns: [],
            is_period: false,
            is_enforced: true,
            is_inherited: true,
          },
        ] as T[]
      }
      if (text.includes('FROM pg_class t')) {
        return [
          {
            index_name: 'orders_2026_pkey',
            column_name: 'id',
            column_definition: 'id',
            ord: 1,
            is_unique: true,
            is_primary: true,
            is_constraint: true,
            is_included: false,
            create_script_only: false,
            create_script: 'CREATE UNIQUE INDEX orders_2026_pkey ON sales.orders_2026 (id)',
            is_inherited: true,
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'sales', 'orders_2026')).toMatchObject({
      type: 'table',
      primaryKey: ['id'],
      keyConstraints: [
        {
          name: 'orders_2026_pkey',
          type: 'PRIMARY KEY',
          columns: ['id'],
          inherited: true,
        },
      ],
      foreignKeys: [
        {
          name: 'orders_2026_user_fkey',
          columns: ['id'],
          refSchema: 'identity',
          refTable: 'users',
          refColumns: ['id'],
          onUpdate: 'NO ACTION',
          onDelete: 'NO ACTION',
          match: 'SIMPLE',
          deferrable: false,
          initiallyDeferred: false,
          validated: true,
          enforced: true,
          inherited: true,
        },
      ],
      indexes: [
        {
          name: 'orders_2026_pkey',
          columns: ['id'],
          unique: true,
          primary: true,
          constraint: true,
          createScript: 'CREATE UNIQUE INDEX orders_2026_pkey ON sales.orders_2026 (id)',
          inherited: true,
        },
      ],
      postgresPartition: {
        parentSchema: 'sales',
        parentTable: 'orders',
        bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
        defaultOverrides: [
          { column: 'region', value: "'eu'::text" },
          { column: 'obsolete', value: null },
        ],
        notNullColumns: ['region'],
      },
    })
    expect(parentReads).toBe(1)
    expect(overrideReads).toBe(1)
  })

  it('preserves ordinary table inheritance, parent order, and purely local state', async () => {
    let parentReads = 0
    let overrideReads = 0
    let partitionReads = 0
    const rows: RowsExecutor = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
      if (text.includes('reltuples::bigint'))
        return [{ reltuples: '5', relkind: 'r', is_partition: false }] as T[]
      if (text.includes('child_table.relpartbound')) {
        partitionReads++
        return [] as T[]
      }
      if (
        text.includes('JOIN pg_catalog.pg_inherits inheritance') &&
        text.includes('NOT COALESCE')
      ) {
        parentReads++
        expect(text).toContain('ORDER BY inheritance.inhseqno')
        expect(params).toEqual(['public', 'customer_events'])
        return [
          { parent_schema: 'audit', parent_table: 'events' },
          { parent_schema: 'crm', parent_table: 'customers' },
        ] as T[]
      }
      if (text.includes('NOT child_attribute.attislocal')) {
        overrideReads++
        expect(text).toContain('ORDER BY child_attribute.attnum, inheritance.inhseqno')
        expect(params).toEqual(['public', 'customer_events'])
        return [
          {
            column_name: 'id',
            child_default: "nextval('audit.events_id_seq'::regclass)",
            parent_default: "nextval('audit.events_id_seq'::regclass)",
            child_not_null: true,
            parent_not_null: true,
          },
          {
            column_name: 'status',
            child_default: "'active'::text",
            parent_default: "'pending'::text",
            child_not_null: true,
            parent_not_null: false,
          },
          {
            column_name: 'status',
            child_default: "'active'::text",
            parent_default: "'pending'::text",
            child_not_null: true,
            parent_not_null: false,
          },
          {
            column_name: 'legacy',
            child_default: null,
            parent_default: "'legacy'::text",
            child_not_null: false,
            parent_not_null: false,
          },
        ] as T[]
      }
      if (text.includes('information_schema.columns')) {
        expect(text).toContain('a.attislocal AS is_local')
        return [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: "nextval('audit.events_id_seq'::regclass)",
            is_local: false,
          },
          {
            column_name: 'status',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: "'active'::text",
            is_local: false,
          },
          {
            column_name: 'legacy',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
            is_local: false,
          },
          {
            column_name: 'note',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
            is_local: true,
          },
          {
            column_name: 'tag',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: "'local'::text",
            is_local: true,
          },
        ] as T[]
      }
      if (text.includes('check_constraint.contype')) {
        return [
          {
            constraint_type: 'c',
            constraint_name: 'events_status_check',
            expression: "status <> 'invalid'::text",
            exclusion_definition: null,
            is_validated: true,
            no_inherit: false,
            is_enforced: true,
            is_inherited: true,
          },
          {
            constraint_type: 'c',
            constraint_name: 'customer_events_note_check',
            expression: "note <> ''::text",
            exclusion_definition: null,
            is_validated: true,
            no_inherit: false,
            is_enforced: true,
            is_inherited: false,
          },
        ] as T[]
      }
      return [] as T[]
    }

    expect(await pgTableSchema(rows, 'public', 'customer_events')).toMatchObject({
      type: 'table',
      checkConstraints: [
        {
          name: 'events_status_check',
          expression: "status <> 'invalid'::text",
          inherited: true,
        },
        {
          name: 'customer_events_note_check',
          expression: "note <> ''::text",
        },
      ],
      postgresInheritance: {
        parents: [
          { schema: 'audit', table: 'events' },
          { schema: 'crm', table: 'customers' },
        ],
        localColumns: ['note', 'tag'],
        defaultOverrides: [
          { column: 'status', value: "'active'::text" },
          { column: 'legacy', value: null },
        ],
        notNullColumns: ['status'],
      },
    })
    expect(parentReads).toBe(1)
    expect(overrideReads).toBe(1)
    expect(partitionReads).toBe(0)
  })
})
