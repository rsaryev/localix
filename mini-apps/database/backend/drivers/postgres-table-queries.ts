// PostgreSQL introspection over information_schema + pg_catalog, mapped onto the
// dialect-agnostic schema shape. Pure with respect to the connection: catalog
// queries run through the driver's RowsExecutor.
import type { RowsExecutor } from './fk-rows'
import type {
  PgColumnRow,
  PgExtendedStatisticRow,
  PgForeignColumnRow,
  PgForeignTableRow,
  PgInheritanceParentRow,
  PgPartitionColumnRow,
  PgPartitionRow,
  PgPolicyRow,
  PgPrivilegeRow,
  PgSequencePrivilegeRow,
} from './postgres-catalog-rows'

/**
 * Everything this driver asks the PostgreSQL catalog about one table, fired at once.
 *
 * Twenty queries, parallel deliberately: they are independent reads against `pg_catalog` /
 * `information_schema`, and serialising them would turn one panel open into twenty round-trips.
 * The four that DO depend on another — the foreign-table, partition-key and inheritance reads —
 * hang off `statRowsPromise` rather than off an `await`, so the dependency costs one round-trip
 * instead of a barrier.
 *
 * Split from the assembly that consumes it. `postgres-introspect.ts` was 1,637 lines and this was
 * 920 of them: SQL wedged between a signature and the mapping code, so neither could be read
 * without scrolling past the other. The seam is exactly the `Promise.all` — what we ASK is here,
 * what we MAKE OF IT is there.
 */
export async function readPgTableCatalog(rows: RowsExecutor, sch: string, table: string) {
  const colRowsPromise = rows<PgColumnRow>(
    `SELECT column_name, data_type, comment, is_nullable, column_default, is_local,
            generated_kind, generated_expression, identity_kind,
            sequence_schema, sequence_name, sequence_data_type,
            sequence_start, sequence_increment, sequence_min, sequence_max,
            sequence_cache, sequence_cycle, sequence_unlogged,
            sequence_comment, sequence_owner, sequence_acl_explicit,
            collation_schema, collation_name, storage_kind,
            compression_method, statistics_target, attribute_options
     FROM (
       SELECT c.column_name::text AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
              c.is_nullable::text, c.column_default::text, c.ordinal_position::integer,
              a.attislocal AS is_local,
              COALESCE(to_jsonb(a)->>'attgenerated', '') AS generated_kind,
              CASE
                WHEN COALESCE(to_jsonb(a)->>'attgenerated', '') <> ''
                THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
                ELSE NULL
              END AS generated_expression,
              COALESCE(to_jsonb(a)->>'attidentity', '') AS identity_kind,
              owned_seq.sequence_schema, owned_seq.sequence_name,
              owned_seq.sequence_data_type, owned_seq.sequence_start,
              owned_seq.sequence_increment, owned_seq.sequence_min,
              owned_seq.sequence_max, owned_seq.sequence_cache,
              owned_seq.sequence_cycle, owned_seq.sequence_unlogged,
              owned_seq.sequence_comment, owned_seq.sequence_owner,
              owned_seq.sequence_acl_explicit,
              CASE WHEN a.attcollation <> attribute_type.typcollation
                THEN collation_schema.nspname::text
                ELSE NULL
              END AS collation_schema,
              CASE WHEN a.attcollation <> attribute_type.typcollation
                THEN attribute_collation.collname::text
                ELSE NULL
              END AS collation_name,
              CASE WHEN a.attstorage <> attribute_type.typstorage
                THEN CASE a.attstorage
                  WHEN 'p' THEN 'PLAIN'
                  WHEN 'e' THEN 'EXTERNAL'
                  WHEN 'x' THEN 'EXTENDED'
                  WHEN 'm' THEN 'MAIN'
                  ELSE NULL
                END
                ELSE NULL
              END AS storage_kind,
              CASE COALESCE(to_jsonb(a)->>'attcompression', '')
                WHEN 'p' THEN 'pglz'
                WHEN 'l' THEN 'lz4'
                ELSE NULL
              END AS compression_method,
              NULLIF(a.attstattarget, -1) AS statistics_target,
              a.attoptions AS attribute_options
       FROM information_schema.columns c
       JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
       JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
       JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
       JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid = a.atttypid
       LEFT JOIN pg_catalog.pg_collation attribute_collation
         ON attribute_collation.oid = a.attcollation
       LEFT JOIN pg_catalog.pg_namespace collation_schema
         ON collation_schema.oid = attribute_collation.collnamespace
       LEFT JOIN pg_catalog.pg_attrdef ad
         ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       LEFT JOIN LATERAL (
         SELECT seq_ns.nspname::text AS sequence_schema,
                seq_cls.relname::text AS sequence_name,
                pg_catalog.format_type(seq.seqtypid, NULL) AS sequence_data_type,
                seq.seqstart::text AS sequence_start,
                seq.seqincrement::text AS sequence_increment,
                seq.seqmin::text AS sequence_min, seq.seqmax::text AS sequence_max,
                seq.seqcache::text AS sequence_cache, seq.seqcycle AS sequence_cycle,
                seq_cls.relpersistence = 'u' AS sequence_unlogged,
                pg_catalog.obj_description(seq_cls.oid, 'pg_class') AS sequence_comment,
                pg_catalog.pg_get_userbyid(seq_cls.relowner) AS sequence_owner,
                seq_cls.relacl IS NOT NULL AS sequence_acl_explicit
         FROM pg_catalog.pg_depend dep
         JOIN pg_catalog.pg_class seq_cls ON seq_cls.oid = dep.objid
         JOIN pg_catalog.pg_namespace seq_ns ON seq_ns.oid = seq_cls.relnamespace
         JOIN pg_catalog.pg_sequence seq ON seq.seqrelid = seq_cls.oid
         WHERE dep.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
           AND dep.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
           AND dep.refobjid = t.oid AND dep.refobjsubid = a.attnum
           AND dep.deptype IN ('a', 'i') AND seq_cls.relkind = 'S'
         LIMIT 1
       ) owned_seq ON true
       WHERE c.table_schema = $1 AND c.table_name = $2
       UNION ALL
       SELECT a.attname::text AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
              CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
              NULL::text AS column_default, a.attnum AS ordinal_position,
              a.attislocal AS is_local,
              NULL::text AS generated_kind, NULL::text AS generated_expression,
              NULL::text AS identity_kind, NULL::text AS sequence_schema,
              NULL::text AS sequence_name, NULL::text AS sequence_data_type,
              NULL::text AS sequence_start, NULL::text AS sequence_increment,
              NULL::text AS sequence_min, NULL::text AS sequence_max,
              NULL::text AS sequence_cache, NULL::boolean AS sequence_cycle,
              NULL::boolean AS sequence_unlogged,
              NULL::text AS sequence_comment, NULL::text AS sequence_owner,
              NULL::boolean AS sequence_acl_explicit,
              CASE WHEN a.attcollation <> attribute_type.typcollation
                THEN collation_schema.nspname::text
                ELSE NULL
              END AS collation_schema,
              CASE WHEN a.attcollation <> attribute_type.typcollation
                THEN attribute_collation.collname::text
                ELSE NULL
              END AS collation_name,
              CASE WHEN a.attstorage <> attribute_type.typstorage
                THEN CASE a.attstorage
                  WHEN 'p' THEN 'PLAIN'
                  WHEN 'e' THEN 'EXTERNAL'
                  WHEN 'x' THEN 'EXTENDED'
                  WHEN 'm' THEN 'MAIN'
                  ELSE NULL
                END
                ELSE NULL
              END AS storage_kind,
              CASE COALESCE(to_jsonb(a)->>'attcompression', '')
                WHEN 'p' THEN 'pglz'
                WHEN 'l' THEN 'lz4'
                ELSE NULL
              END AS compression_method,
              NULLIF(a.attstattarget, -1) AS statistics_target,
              a.attoptions AS attribute_options
       FROM pg_catalog.pg_class t
       JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
       JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid = a.atttypid
       LEFT JOIN pg_catalog.pg_collation attribute_collation
         ON attribute_collation.oid = a.attcollation
       LEFT JOIN pg_catalog.pg_namespace collation_schema
         ON collation_schema.oid = attribute_collation.collnamespace
       WHERE n.nspname = $1 AND t.relname = $2 AND t.relkind = 'm'
         AND a.attnum > 0 AND NOT a.attisdropped
         AND has_column_privilege(t.oid, a.attnum, 'SELECT')
    ) AS relation_columns
     ORDER BY ordinal_position`,
    [sch, table],
  ).catch(() =>
    // PostgreSQL-compatible services and pre-10 servers may not expose pg_sequence.
    // Keep schema browsing and version-independent column properties available, but
    // leave identity/generated/owned-sequence fields absent rather than guessing.
    rows<PgColumnRow>(
      `SELECT column_name, data_type, comment, is_nullable, column_default, is_local,
              collation_schema, collation_name, storage_kind,
              compression_method, statistics_target, attribute_options
       FROM (
         SELECT c.column_name::text AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
                c.is_nullable::text, c.column_default::text, c.ordinal_position::integer,
                a.attislocal AS is_local,
                CASE WHEN a.attcollation <> attribute_type.typcollation
                  THEN collation_schema.nspname::text
                  ELSE NULL
                END AS collation_schema,
                CASE WHEN a.attcollation <> attribute_type.typcollation
                  THEN attribute_collation.collname::text
                  ELSE NULL
                END AS collation_name,
                CASE WHEN a.attstorage <> attribute_type.typstorage
                  THEN CASE a.attstorage
                    WHEN 'p' THEN 'PLAIN'
                    WHEN 'e' THEN 'EXTERNAL'
                    WHEN 'x' THEN 'EXTENDED'
                    WHEN 'm' THEN 'MAIN'
                    ELSE NULL
                  END
                  ELSE NULL
                END AS storage_kind,
                CASE COALESCE(to_jsonb(a)->>'attcompression', '')
                  WHEN 'p' THEN 'pglz'
                  WHEN 'l' THEN 'lz4'
                  ELSE NULL
                END AS compression_method,
                NULLIF(a.attstattarget, -1) AS statistics_target,
                a.attoptions AS attribute_options
         FROM information_schema.columns c
         JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
         JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
         JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
         JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid = a.atttypid
         LEFT JOIN pg_catalog.pg_collation attribute_collation
           ON attribute_collation.oid = a.attcollation
         LEFT JOIN pg_catalog.pg_namespace collation_schema
           ON collation_schema.oid = attribute_collation.collnamespace
         WHERE c.table_schema = $1 AND c.table_name = $2
         UNION ALL
         SELECT a.attname::text AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
                NULL::text AS column_default, a.attnum AS ordinal_position,
                a.attislocal AS is_local,
                CASE WHEN a.attcollation <> attribute_type.typcollation
                  THEN collation_schema.nspname::text
                  ELSE NULL
                END AS collation_schema,
                CASE WHEN a.attcollation <> attribute_type.typcollation
                  THEN attribute_collation.collname::text
                  ELSE NULL
                END AS collation_name,
                CASE WHEN a.attstorage <> attribute_type.typstorage
                  THEN CASE a.attstorage
                    WHEN 'p' THEN 'PLAIN'
                    WHEN 'e' THEN 'EXTERNAL'
                    WHEN 'x' THEN 'EXTENDED'
                    WHEN 'm' THEN 'MAIN'
                    ELSE NULL
                  END
                  ELSE NULL
                END AS storage_kind,
                CASE COALESCE(to_jsonb(a)->>'attcompression', '')
                  WHEN 'p' THEN 'pglz'
                  WHEN 'l' THEN 'lz4'
                  ELSE NULL
                END AS compression_method,
                NULLIF(a.attstattarget, -1) AS statistics_target,
                a.attoptions AS attribute_options
         FROM pg_catalog.pg_class t
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
         JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid = a.atttypid
         LEFT JOIN pg_catalog.pg_collation attribute_collation
           ON attribute_collation.oid = a.attcollation
         LEFT JOIN pg_catalog.pg_namespace collation_schema
           ON collation_schema.oid = attribute_collation.collnamespace
         WHERE n.nspname = $1 AND t.relname = $2 AND t.relkind = 'm'
           AND a.attnum > 0 AND NOT a.attisdropped
           AND has_column_privilege(t.oid, a.attnum, 'SELECT')
       ) AS relation_columns
       ORDER BY ordinal_position`,
      [sch, table],
    ),
  )
  const keyRowsPromise = rows<{
    constraint_name: string
    constraint_type: string
    column_name: string
    ord: number | string
    is_included: boolean
    is_deferrable: boolean
    initially_deferred: boolean
    nulls_not_distinct: boolean
    without_overlaps: boolean
    is_inherited: boolean
  }>(
    `SELECT con.conname AS constraint_name, con.contype AS constraint_type,
            att.attname AS column_name, key_col.ord,
            key_col.ord > idx.indnkeyatts AS is_included,
            con.condeferrable AS is_deferrable,
            con.condeferred AS initially_deferred,
            COALESCE(
              (to_jsonb(idx)->>'indnullsnotdistinct')::boolean, false
            ) AS nulls_not_distinct,
            COALESCE(
              (to_jsonb(con)->>'conperiod')::boolean, false
            ) AS without_overlaps,
            COALESCE(
              (to_jsonb(con)->>'conparentid')::pg_catalog.oid, 0
            ) <> 0
              OR (NOT con.conislocal AND con.coninhcount > 0) AS is_inherited
     FROM pg_catalog.pg_constraint con
     JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
     JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
     JOIN pg_catalog.pg_index idx ON idx.indexrelid = con.conindid
     JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS key_col(attnum, ord) ON true
     JOIN pg_catalog.pg_attribute att
       ON att.attrelid = con.conrelid AND att.attnum = key_col.attnum
     WHERE con.contype IN ('p', 'u')
       AND ns.nspname = $1 AND cls.relname = $2
     ORDER BY con.oid, key_col.ord`,
    [sch, table],
  )
  const fkRowsPromise = rows<{
    constraint_name: string
    column_name: string
    ref_schema: string
    ref_table: string
    ref_column: string
    update_action: string
    delete_action: string
    match_type: string
    is_deferrable: boolean
    initially_deferred: boolean
    is_validated: boolean
    delete_action_columns: string[]
    is_period: boolean
    is_enforced: boolean
    is_inherited: boolean
  }>(
    `SELECT con.conname AS constraint_name, src_att.attname AS column_name,
            ref_ns.nspname AS ref_schema, ref_cls.relname AS ref_table,
            ref_att.attname AS ref_column,
            con.confupdtype AS update_action, con.confdeltype AS delete_action,
            con.confmatchtype AS match_type, con.condeferrable AS is_deferrable,
            con.condeferred AS initially_deferred, con.convalidated AS is_validated,
            ARRAY(
              SELECT delete_att.attname
              FROM jsonb_array_elements_text(
                COALESCE(to_jsonb(con)->'confdelsetcols', '[]'::jsonb)
              ) WITH ORDINALITY AS delete_key(attnum, ord)
              JOIN pg_catalog.pg_attribute delete_att
                ON delete_att.attrelid = con.conrelid
               AND delete_att.attnum = delete_key.attnum::smallint
              ORDER BY delete_key.ord
            ) AS delete_action_columns,
            COALESCE((to_jsonb(con)->>'conperiod')::boolean, false) AS is_period,
            COALESCE((to_jsonb(con)->>'conenforced')::boolean, true) AS is_enforced,
            COALESCE(
              (to_jsonb(con)->>'conparentid')::pg_catalog.oid, 0
            ) <> 0
              OR (NOT con.conislocal AND con.coninhcount > 0) AS is_inherited
     FROM pg_catalog.pg_constraint con
     JOIN pg_catalog.pg_class src_cls ON src_cls.oid = con.conrelid
     JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
     JOIN pg_catalog.pg_class ref_cls ON ref_cls.oid = con.confrelid
     JOIN pg_catalog.pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
     JOIN LATERAL unnest(con.conkey, con.confkey)
       WITH ORDINALITY AS key_pair(src_attnum, ref_attnum, ord) ON true
     JOIN pg_catalog.pg_attribute src_att
       ON src_att.attrelid = con.conrelid AND src_att.attnum = key_pair.src_attnum
     JOIN pg_catalog.pg_attribute ref_att
       ON ref_att.attrelid = con.confrelid AND ref_att.attnum = key_pair.ref_attnum
     WHERE con.contype = 'f' AND src_ns.nspname = $1 AND src_cls.relname = $2
     ORDER BY con.oid, key_pair.ord`,
    [sch, table],
  )
  const checkRowsPromise = rows<{
    constraint_type: string
    constraint_name: string
    column_name: string | null
    expression: string | null
    exclusion_definition: string | null
    is_validated: boolean
    no_inherit: boolean
    is_enforced: boolean
    is_inherited: boolean
  }>(
    `SELECT check_constraint.contype AS constraint_type,
            check_constraint.conname AS constraint_name,
            constrained_column.attname AS column_name,
            CASE WHEN check_constraint.contype = 'c'
              THEN pg_catalog.pg_get_expr(
                check_constraint.conbin, check_constraint.conrelid, false
              )
              ELSE NULL
            END AS expression,
            CASE WHEN check_constraint.contype = 'x'
              THEN pg_catalog.pg_get_constraintdef(check_constraint.oid, false)
              ELSE NULL
            END AS exclusion_definition,
            check_constraint.convalidated AS is_validated,
            check_constraint.connoinherit AS no_inherit,
            COALESCE(
              (to_jsonb(check_constraint)->>'conenforced')::boolean, true
            ) AS is_enforced,
            COALESCE(
              (to_jsonb(check_constraint)->>'conparentid')::pg_catalog.oid, 0
            ) <> 0
              OR (
                NOT check_constraint.conislocal
                AND check_constraint.coninhcount > 0
              ) AS is_inherited
     FROM pg_catalog.pg_constraint check_constraint
     JOIN pg_catalog.pg_class checked_table
       ON checked_table.oid = check_constraint.conrelid
     JOIN pg_catalog.pg_namespace checked_schema
       ON checked_schema.oid = checked_table.relnamespace
     LEFT JOIN pg_catalog.pg_attribute constrained_column
       ON check_constraint.contype = 'n'
      AND constrained_column.attrelid = check_constraint.conrelid
      AND constrained_column.attnum = check_constraint.conkey[1]
     WHERE check_constraint.contype IN ('c', 'x', 'n')
       AND checked_schema.nspname = $1 AND checked_table.relname = $2
     ORDER BY check_constraint.oid`,
    [sch, table],
  )
  // pg_get_indexdef preserves expression keys, partial predicates, access methods,
  // collations and operator classes as executable native DDL. The per-attribute form
  // supplies a compact display label when indkey uses zero for an expression; physical
  // key/include columns keep their actual catalog names.
  const idxRowsPromise = rows<{
    index_name: string
    column_name: string | null
    column_definition: string
    ord: string | number
    is_unique: boolean
    is_primary: boolean
    is_constraint: boolean
    is_included: boolean
    create_script_only: boolean
    create_script: string
    is_inherited: boolean
  }>(
    `SELECT i.relname AS index_name, a.attname AS column_name,
            pg_get_indexdef(ix.indexrelid, k.ord::integer, false) AS column_definition,
            k.ord AS ord,
            ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
            k.ord > ix.indnkeyatts AS is_included,
            (ix.indexprs IS NOT NULL OR ix.indpred IS NOT NULL) AS create_script_only,
            pg_get_indexdef(ix.indexrelid) AS create_script,
            COALESCE(
              (to_jsonb(i)->>'relispartition')::boolean, false
            ) AS is_inherited,
            EXISTS (
              SELECT 1 FROM pg_constraint con
              WHERE con.conindid = ix.indexrelid AND con.contype IN ('p', 'u')
            ) AS is_constraint
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON ix.indrelid = t.oid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = $1 AND t.relname = $2
       AND ix.indisvalid
       AND ix.indislive
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint con
         WHERE con.conindid = ix.indexrelid AND con.contype = 'x'
       )
     ORDER BY i.relname, k.ord`,
    [sch, table],
  )
  // pg_get_triggerdef is PostgreSQL's executable deparser. Exclude internal
  // constraint machinery and partition clones: creating the parent trigger
  // recreates those clones automatically. to_jsonb keeps this query compatible
  // with servers from before pg_trigger.tgparentid was introduced.
  const triggerRowsPromise = rows<{
    trigger_name: string
    create_script: string
    enabled_state: string
  }>(
    `SELECT trigger_catalog.tgname AS trigger_name,
            pg_catalog.pg_get_triggerdef(trigger_catalog.oid, false) AS create_script,
            trigger_catalog.tgenabled AS enabled_state
     FROM pg_catalog.pg_trigger trigger_catalog
     JOIN pg_catalog.pg_class trigger_table
       ON trigger_table.oid = trigger_catalog.tgrelid
     JOIN pg_catalog.pg_namespace trigger_schema
       ON trigger_schema.oid = trigger_table.relnamespace
     WHERE trigger_schema.nspname = $1 AND trigger_table.relname = $2
       AND NOT trigger_catalog.tgisinternal
       AND COALESCE(
         (to_jsonb(trigger_catalog)->>'tgparentid')::pg_catalog.oid, 0
       ) = 0
     ORDER BY trigger_catalog.tgname`,
    [sch, table],
  )
  const ruleRowsPromise = rows<{
    rule_name: string
    create_script: string
    enabled_state: string
  }>(
    `SELECT rewrite_rule.rulename AS rule_name,
            pg_catalog.pg_get_ruledef(rewrite_rule.oid, false) AS create_script,
            rewrite_rule.ev_enabled AS enabled_state
     FROM pg_catalog.pg_rewrite rewrite_rule
     JOIN pg_catalog.pg_class rule_table
       ON rule_table.oid = rewrite_rule.ev_class
     JOIN pg_catalog.pg_namespace rule_schema
       ON rule_schema.oid = rule_table.relnamespace
     WHERE rule_schema.nspname = $1 AND rule_table.relname = $2
       AND NOT (
         rewrite_rule.rulename = '_RETURN'
         AND rewrite_rule.ev_type = '1'
       )
     ORDER BY rewrite_rule.rulename`,
    [sch, table],
  )
  const policyRowsPromise = rows<PgPolicyRow>(
    `SELECT policy.polname AS policy_name,
            CASE policy.polcmd
              WHEN '*' THEN 'ALL'
              WHEN 'r' THEN 'SELECT'
              WHEN 'a' THEN 'INSERT'
              WHEN 'w' THEN 'UPDATE'
              WHEN 'd' THEN 'DELETE'
            END AS command_kind,
            COALESCE(
              (to_jsonb(policy)->>'polpermissive')::boolean, true
            ) AS permissive,
            ARRAY(
              SELECT CASE policy_role.role_oid
                WHEN 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(policy_role.role_oid)
              END
              FROM unnest(policy.polroles) WITH ORDINALITY
                AS policy_role(role_oid, ord)
              ORDER BY policy_role.ord
            ) AS roles,
            pg_catalog.pg_get_expr(
              policy.polqual, policy.polrelid, false
            ) AS using_expression,
            pg_catalog.pg_get_expr(
              policy.polwithcheck, policy.polrelid, false
            ) AS check_expression
     FROM pg_catalog.pg_policy policy
     JOIN pg_catalog.pg_class policy_table
       ON policy_table.oid = policy.polrelid
     JOIN pg_catalog.pg_namespace policy_schema
       ON policy_schema.oid = policy_table.relnamespace
     WHERE policy_schema.nspname = $1 AND policy_table.relname = $2
     ORDER BY policy.oid`,
    [sch, table],
  ).catch(() => [] as PgPolicyRow[])
  const privilegeRowsPromise = rows<PgPrivilegeRow>(
    `SELECT NULL::text AS column_name,
            pg_catalog.pg_get_userbyid(privilege.grantor) AS grantor,
            CASE WHEN privilege.grantee = 0 THEN NULL
              ELSE pg_catalog.pg_get_userbyid(privilege.grantee)
            END AS grantee,
            privilege.grantee = 0 AS is_public,
            privilege.privilege_type,
            privilege.is_grantable
     FROM pg_catalog.pg_class access_table
     JOIN pg_catalog.pg_namespace access_schema
       ON access_schema.oid = access_table.relnamespace
     LEFT JOIN LATERAL pg_catalog.aclexplode(access_table.relacl)
       AS privilege ON true
     WHERE access_schema.nspname = $1 AND access_table.relname = $2
       AND access_table.relacl IS NOT NULL
     UNION ALL
     SELECT access_column.attname::text AS column_name,
            pg_catalog.pg_get_userbyid(privilege.grantor) AS grantor,
            CASE WHEN privilege.grantee = 0 THEN NULL
              ELSE pg_catalog.pg_get_userbyid(privilege.grantee)
            END AS grantee,
            privilege.grantee = 0 AS is_public,
            privilege.privilege_type,
            privilege.is_grantable
     FROM pg_catalog.pg_class access_table
     JOIN pg_catalog.pg_namespace access_schema
       ON access_schema.oid = access_table.relnamespace
     JOIN pg_catalog.pg_attribute access_column
       ON access_column.attrelid = access_table.oid
      AND access_column.attnum > 0
      AND NOT access_column.attisdropped
     LEFT JOIN LATERAL pg_catalog.aclexplode(access_column.attacl)
       AS privilege ON true
     WHERE access_schema.nspname = $1 AND access_table.relname = $2
       AND access_column.attacl IS NOT NULL
     ORDER BY column_name NULLS FIRST, grantor, grantee, privilege_type`,
    [sch, table],
  ).catch(() => undefined)
  const sequencePrivilegeRowsPromise = rows<PgSequencePrivilegeRow>(
    `SELECT sequence_schema.nspname::text AS sequence_schema,
            sequence_table.relname::text AS sequence_name,
            NULL::text AS column_name,
            pg_catalog.pg_get_userbyid(privilege.grantor) AS grantor,
            CASE WHEN privilege.grantee = 0 THEN NULL
              ELSE pg_catalog.pg_get_userbyid(privilege.grantee)
            END AS grantee,
            privilege.grantee = 0 AS is_public,
            privilege.privilege_type,
            privilege.is_grantable
     FROM pg_catalog.pg_class owning_table
     JOIN pg_catalog.pg_namespace owning_schema
       ON owning_schema.oid = owning_table.relnamespace
     JOIN pg_catalog.pg_depend ownership
       ON ownership.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND ownership.refobjid = owning_table.oid
      AND ownership.refobjsubid > 0
      AND ownership.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND ownership.deptype IN ('a', 'i')
     JOIN pg_catalog.pg_class sequence_table
       ON sequence_table.oid = ownership.objid
      AND sequence_table.relkind = 'S'
     JOIN pg_catalog.pg_namespace sequence_schema
       ON sequence_schema.oid = sequence_table.relnamespace
     LEFT JOIN LATERAL pg_catalog.aclexplode(sequence_table.relacl)
       AS privilege ON true
     WHERE owning_schema.nspname = $1 AND owning_table.relname = $2
       AND sequence_table.relacl IS NOT NULL
     ORDER BY sequence_schema, sequence_name, grantor, grantee, privilege_type`,
    [sch, table],
  ).catch(() => undefined)
  const extendedStatisticRowsPromise = rows<PgExtendedStatisticRow>(
    `SELECT statistics_schema.nspname::text AS statistics_schema,
            statistics_object.stxname::text AS statistics_name,
            pg_catalog.pg_get_statisticsobjdef(statistics_object.oid) AS create_script,
            pg_catalog.pg_get_userbyid(statistics_object.stxowner) AS owner_name,
            statistics_object.stxstattarget AS statistics_target,
            pg_catalog.obj_description(
              statistics_object.oid, 'pg_statistic_ext'
            ) AS comment
     FROM pg_catalog.pg_statistic_ext statistics_object
     JOIN pg_catalog.pg_namespace statistics_schema
       ON statistics_schema.oid = statistics_object.stxnamespace
     JOIN pg_catalog.pg_class statistics_table
       ON statistics_table.oid = statistics_object.stxrelid
     JOIN pg_catalog.pg_namespace table_schema
       ON table_schema.oid = statistics_table.relnamespace
     WHERE table_schema.nspname = $1 AND statistics_table.relname = $2
     ORDER BY statistics_object.oid`,
    [sch, table],
  ).catch(() => undefined)
  // pg_class.reltuples is the planner's cached estimate (cheap, no scan). It is -1
  // (or 0) before the first ANALYZE/autovacuum — treat <0 as "unknown" and omit.
  const statRowsPromise = rows<{
    reltuples: string | number
    relkind: string
    is_partition: boolean
    persistence: string
    access_method: string | null
    storage_parameters: string[] | null
    tablespace: string | null
    of_type_schema: string | null
    of_type_name: string | null
    row_security: boolean
    force_row_security: boolean
    replica_identity: string
    replica_identity_index: string | null
    clustered_index: string | null
    relation_comment: string | null
    owner_name: string
    acl_explicit: boolean
  }>(
    `SELECT c.reltuples::bigint AS reltuples, c.relkind,
            COALESCE((to_jsonb(c)->>'relispartition')::boolean, false) AS is_partition,
            c.relpersistence AS persistence,
            relation_access_method.amname AS access_method,
            c.reloptions AS storage_parameters,
            relation_tablespace.spcname AS tablespace,
            relation_type_schema.nspname AS of_type_schema,
            relation_type.typname AS of_type_name,
            COALESCE(
              (to_jsonb(c)->>'relrowsecurity')::boolean, false
            ) AS row_security,
            COALESCE(
              (to_jsonb(c)->>'relforcerowsecurity')::boolean, false
            ) AS force_row_security,
            COALESCE(to_jsonb(c)->>'relreplident', 'd') AS replica_identity,
            relation_replica_identity.index_name AS replica_identity_index,
            relation_clustered_index.index_name AS clustered_index,
            pg_catalog.obj_description(c.oid, 'pg_class') AS relation_comment,
            pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
            c.relacl IS NOT NULL AS acl_explicit
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_catalog.pg_am relation_access_method
       ON relation_access_method.oid = c.relam
     LEFT JOIN pg_catalog.pg_tablespace relation_tablespace
       ON relation_tablespace.oid = c.reltablespace
     LEFT JOIN pg_catalog.pg_type relation_type
       ON relation_type.oid = c.reloftype
     LEFT JOIN pg_catalog.pg_namespace relation_type_schema
       ON relation_type_schema.oid = relation_type.typnamespace
     LEFT JOIN LATERAL (
       SELECT replica_index.relname::text AS index_name
       FROM pg_catalog.pg_index replica_index_catalog
       JOIN pg_catalog.pg_class replica_index
         ON replica_index.oid = replica_index_catalog.indexrelid
       WHERE replica_index_catalog.indrelid = c.oid
         AND COALESCE(
           (to_jsonb(replica_index_catalog)->>'indisreplident')::boolean, false
         )
       LIMIT 1
     ) relation_replica_identity ON true
     LEFT JOIN LATERAL (
       SELECT clustered_index.relname::text AS index_name
       FROM pg_catalog.pg_index clustered_index_catalog
       JOIN pg_catalog.pg_class clustered_index
         ON clustered_index.oid = clustered_index_catalog.indexrelid
       WHERE clustered_index_catalog.indrelid = c.oid
         AND COALESCE(
           (to_jsonb(clustered_index_catalog)->>'indisclustered')::boolean, false
         )
       LIMIT 1
     ) relation_clustered_index ON true
     WHERE n.nspname = $1 AND c.relname = $2 LIMIT 1`,
    [sch, table],
  )
  const foreignTableRowsPromise = statRowsPromise.then((statRows) => {
    if (statRows[0]?.relkind !== 'f') return [] as PgForeignTableRow[]
    return rows<PgForeignTableRow>(
      `SELECT foreign_server.srvname AS server_name,
              foreign_table.ftoptions AS table_options
       FROM pg_catalog.pg_class foreign_relation
       JOIN pg_catalog.pg_namespace foreign_schema
         ON foreign_schema.oid = foreign_relation.relnamespace
       JOIN pg_catalog.pg_foreign_table foreign_table
         ON foreign_table.ftrelid = foreign_relation.oid
       JOIN pg_catalog.pg_foreign_server foreign_server
         ON foreign_server.oid = foreign_table.ftserver
       WHERE foreign_schema.nspname = $1 AND foreign_relation.relname = $2
         AND foreign_relation.relkind = 'f'
       LIMIT 1`,
      [sch, table],
    )
  })
  const foreignColumnRowsPromise = statRowsPromise.then((statRows) => {
    if (statRows[0]?.relkind !== 'f') return [] as PgForeignColumnRow[]
    return rows<PgForeignColumnRow>(
      `SELECT foreign_column.attname AS column_name,
              foreign_column.attfdwoptions AS column_options
       FROM pg_catalog.pg_class foreign_relation
       JOIN pg_catalog.pg_namespace foreign_schema
         ON foreign_schema.oid = foreign_relation.relnamespace
       JOIN pg_catalog.pg_attribute foreign_column
         ON foreign_column.attrelid = foreign_relation.oid
       WHERE foreign_schema.nspname = $1 AND foreign_relation.relname = $2
         AND foreign_relation.relkind = 'f'
         AND foreign_column.attnum > 0
         AND NOT foreign_column.attisdropped
       ORDER BY foreign_column.attnum`,
      [sch, table],
    )
  })
  // pg_get_partkeydef was introduced together with declarative partitioning in
  // PostgreSQL 10. Resolve the relation kind first so older/compatible servers never
  // have to parse a reference to a function they do not provide.
  const partitionKeyRowsPromise = statRowsPromise.then((statRows) => {
    if (statRows[0]?.relkind !== 'p') return [] as Array<{ partition_key: string | null }>
    return rows<{ partition_key: string | null }>(
      `SELECT pg_catalog.pg_get_partkeydef(c.oid) AS partition_key
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'p'
       LIMIT 1`,
      [sch, table],
    )
  })
  const partitionRowsPromise = statRowsPromise.then((statRows) => {
    if (!statRows[0]?.is_partition) return [] as PgPartitionRow[]
    return rows<PgPartitionRow>(
      `SELECT parent_schema.nspname AS parent_schema,
              parent_table.relname AS parent_table,
              pg_catalog.pg_get_expr(
                child_table.relpartbound, child_table.oid, false
              ) AS partition_bound
       FROM pg_catalog.pg_class child_table
       JOIN pg_catalog.pg_namespace child_schema
         ON child_schema.oid = child_table.relnamespace
       JOIN pg_catalog.pg_inherits inheritance
         ON inheritance.inhrelid = child_table.oid
       JOIN pg_catalog.pg_class parent_table
         ON parent_table.oid = inheritance.inhparent
       JOIN pg_catalog.pg_namespace parent_schema
         ON parent_schema.oid = parent_table.relnamespace
       WHERE child_schema.nspname = $1 AND child_table.relname = $2
         AND child_table.relispartition
       ORDER BY inheritance.inhseqno
       LIMIT 1`,
      [sch, table],
    )
  })
  const partitionColumnRowsPromise = statRowsPromise.then((statRows) => {
    if (!statRows[0]?.is_partition) return [] as PgPartitionColumnRow[]
    return rows<PgPartitionColumnRow>(
      `SELECT child_attribute.attname AS column_name,
              pg_catalog.pg_get_expr(
                child_default.adbin, child_default.adrelid, false
              ) AS child_default,
              pg_catalog.pg_get_expr(
                parent_default.adbin, parent_default.adrelid, false
              ) AS parent_default,
              child_attribute.attnotnull AS child_not_null,
              parent_attribute.attnotnull AS parent_not_null
       FROM pg_catalog.pg_class child_table
       JOIN pg_catalog.pg_namespace child_schema
         ON child_schema.oid = child_table.relnamespace
       JOIN pg_catalog.pg_inherits inheritance
         ON inheritance.inhrelid = child_table.oid
       JOIN pg_catalog.pg_class parent_table
         ON parent_table.oid = inheritance.inhparent
       JOIN pg_catalog.pg_attribute child_attribute
         ON child_attribute.attrelid = child_table.oid
        AND child_attribute.attnum > 0
        AND NOT child_attribute.attisdropped
       JOIN pg_catalog.pg_attribute parent_attribute
         ON parent_attribute.attrelid = parent_table.oid
        AND parent_attribute.attname = child_attribute.attname
        AND NOT parent_attribute.attisdropped
       LEFT JOIN pg_catalog.pg_attrdef child_default
         ON child_default.adrelid = child_attribute.attrelid
        AND child_default.adnum = child_attribute.attnum
       LEFT JOIN pg_catalog.pg_attrdef parent_default
         ON parent_default.adrelid = parent_attribute.attrelid
        AND parent_default.adnum = parent_attribute.attnum
       WHERE child_schema.nspname = $1 AND child_table.relname = $2
         AND child_table.relispartition
       ORDER BY child_attribute.attnum`,
      [sch, table],
    )
  })
  const inheritanceRowsPromise = statRowsPromise.then((statRows) => {
    const relation = statRows[0]
    if (
      relation?.is_partition ||
      (relation?.relkind !== 'r' && relation?.relkind !== 'p' && relation?.relkind !== 'f')
    )
      return [] as PgInheritanceParentRow[]
    return rows<PgInheritanceParentRow>(
      `SELECT parent_schema.nspname AS parent_schema,
              parent_table.relname AS parent_table
       FROM pg_catalog.pg_class child_table
       JOIN pg_catalog.pg_namespace child_schema
         ON child_schema.oid = child_table.relnamespace
       JOIN pg_catalog.pg_inherits inheritance
         ON inheritance.inhrelid = child_table.oid
       JOIN pg_catalog.pg_class parent_table
         ON parent_table.oid = inheritance.inhparent
       JOIN pg_catalog.pg_namespace parent_schema
         ON parent_schema.oid = parent_table.relnamespace
       WHERE child_schema.nspname = $1 AND child_table.relname = $2
         AND NOT COALESCE(
           (to_jsonb(child_table)->>'relispartition')::boolean, false
         )
       ORDER BY inheritance.inhseqno`,
      [sch, table],
    )
  })
  const inheritanceColumnRowsPromise = inheritanceRowsPromise.then((inheritanceRows) => {
    if (inheritanceRows.length === 0) return [] as PgPartitionColumnRow[]
    return rows<PgPartitionColumnRow>(
      `SELECT child_attribute.attname AS column_name,
              pg_catalog.pg_get_expr(
                child_default.adbin, child_default.adrelid, false
              ) AS child_default,
              pg_catalog.pg_get_expr(
                parent_default.adbin, parent_default.adrelid, false
              ) AS parent_default,
              child_attribute.attnotnull AS child_not_null,
              parent_attribute.attnotnull AS parent_not_null
       FROM pg_catalog.pg_class child_table
       JOIN pg_catalog.pg_namespace child_schema
         ON child_schema.oid = child_table.relnamespace
       JOIN pg_catalog.pg_inherits inheritance
         ON inheritance.inhrelid = child_table.oid
       JOIN pg_catalog.pg_class parent_table
         ON parent_table.oid = inheritance.inhparent
       JOIN pg_catalog.pg_attribute child_attribute
         ON child_attribute.attrelid = child_table.oid
        AND child_attribute.attnum > 0
        AND NOT child_attribute.attisdropped
        AND NOT child_attribute.attislocal
       JOIN pg_catalog.pg_attribute parent_attribute
         ON parent_attribute.attrelid = parent_table.oid
        AND parent_attribute.attname = child_attribute.attname
        AND NOT parent_attribute.attisdropped
       LEFT JOIN pg_catalog.pg_attrdef child_default
         ON child_default.adrelid = child_attribute.attrelid
        AND child_default.adnum = child_attribute.attnum
       LEFT JOIN pg_catalog.pg_attrdef parent_default
         ON parent_default.adrelid = parent_attribute.attrelid
        AND parent_default.adnum = parent_attribute.attnum
       WHERE child_schema.nspname = $1 AND child_table.relname = $2
       ORDER BY child_attribute.attnum, inheritance.inhseqno`,
      [sch, table],
    )
  })
  // pg_get_viewdef returns the defining SELECT (not the CREATE wrapper). Match
  // information_schema.views' visibility rule: a SELECT grant can expose rows/columns
  // without granting access to the owner's source definition.
  const definitionRowsPromise = rows<{
    definition: string | null
    relkind: string
    reloptions: string | null
    relispopulated: boolean
  }>(
    `SELECT CASE
              WHEN pg_has_role(c.relowner, 'USAGE') THEN pg_get_viewdef(c.oid, false)
              ELSE NULL
            END AS definition,
            c.relkind, array_to_string(c.reloptions, ', ') AS reloptions,
            c.relispopulated
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('v', 'm')
     LIMIT 1`,
    [sch, table],
  )

  const [
    colRows,
    keyRows,
    fkRows,
    checkRows,
    idxRows,
    triggerRows,
    ruleRows,
    policyRows,
    privilegeRows,
    sequencePrivilegeRows,
    extendedStatisticRows,
    statRows,
    foreignTableRows,
    foreignColumnRows,
    partitionKeyRows,
    partitionRows,
    partitionColumnRows,
    inheritanceRows,
    inheritanceColumnRows,
    definitionRows,
  ] = await Promise.all([
    colRowsPromise,
    keyRowsPromise,
    fkRowsPromise,
    checkRowsPromise,
    idxRowsPromise,
    triggerRowsPromise,
    ruleRowsPromise,
    policyRowsPromise,
    privilegeRowsPromise,
    sequencePrivilegeRowsPromise,
    extendedStatisticRowsPromise,
    statRowsPromise,
    foreignTableRowsPromise,
    foreignColumnRowsPromise,
    partitionKeyRowsPromise,
    partitionRowsPromise,
    partitionColumnRowsPromise,
    inheritanceRowsPromise,
    inheritanceColumnRowsPromise,
    definitionRowsPromise,
  ])
  return {
    colRows,
    keyRows,
    fkRows,
    checkRows,
    idxRows,
    triggerRows,
    ruleRows,
    policyRows,
    privilegeRows,
    sequencePrivilegeRows,
    extendedStatisticRows,
    statRows,
    foreignTableRows,
    foreignColumnRows,
    partitionKeyRows,
    partitionRows,
    partitionColumnRows,
    inheritanceRows,
    inheritanceColumnRows,
    definitionRows,
  }
}
