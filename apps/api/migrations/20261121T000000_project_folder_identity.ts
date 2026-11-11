import { sql, type Kysely } from 'kysely'

// What identifies a project's folder across a rename on its disk: `<device>:<inode>:<birth time>`,
// written each time the folder is seen where the project says it is. A folder renamed while the app
// was closed is then still recognised among its old parent's children on the next start. Empty
// until a folder is first seen; never a guess.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE projects ADD COLUMN folder_identity TEXT`.execute(db)
}
