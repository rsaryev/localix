/**
 * THE PLAN'S FILES, read and written for the host — the draft the agent edits and the version
 * snapshots the person reviews (`plan-paths.ts` says where they are and why).
 *
 * The defect the port shape prevents: a conversation that runs on ssh or docker keeps its files
 * on that machine, and a host that reached for node `fs` would read a draft that is not there and
 * write snapshots nobody can see. So every read and write goes through the ROOT session's
 * execution environment — the same one the agent's tools and the file viewer use — supplied by
 * the host (`bootstrap/session-services.ts`), which keeps this module free of chat and testable
 * with an in-memory environment.
 *
 * The files are the user's (they sit in the project folder): the host never deletes them.
 */
import { sessionRef } from '../chat/session-ref'
import { planDraftDir, planDraftPath, planSnapshotPath } from './plan-paths'
import type { PlanOwner } from './repository'

/** The slice of an execution environment the plan needs. */
export interface PlanFileEnvironment {
  /** Text content; throws when the file cannot be read (absent, most of all). */
  readFile(path: string): Promise<string>
  /** Full content; creates parent directories. */
  writeFile(path: string, content: string): Promise<void>
}

/** Where the ROOT session's files are, and how to reach them. */
export interface PlanFilesHost {
  open(owner: PlanOwner): Promise<{ cwd: string; rootRef: string; env: PlanFileEnvironment }>
}

export interface PlanFiles {
  /** The conversation's plan directory — `planDraftDir(<root cwd>, <root ref>)`. */
  dir(owner: PlanOwner): Promise<string>
  /** The working draft, or null when there is none to read. */
  readDraft(owner: PlanOwner): Promise<string | null>
  writeDraft(owner: PlanOwner, body: string): Promise<void>
  /** Version N as the person sees it, re-written from the stored body. */
  writeSnapshot(owner: PlanOwner, version: number, body: string): Promise<void>
}

/** A root session's plan ref: its `LOCALIX-<seq>`, or its id before a sequence exists. */
export const planRef = (session: { id: string; seq?: number }): string =>
  session.seq === undefined ? session.id : sessionRef(session.seq)

export function createPlanFiles(host: PlanFilesHost): PlanFiles {
  const open = async (owner: PlanOwner) => {
    const { cwd, rootRef, env } = await host.open(owner)
    return { dir: planDraftDir(cwd, rootRef), env }
  }
  return {
    async dir(owner) {
      return (await open(owner)).dir
    },
    async readDraft(owner) {
      const { dir, env } = await open(owner)
      return env.readFile(planDraftPath(dir)).catch(() => null)
    },
    async writeDraft(owner, body) {
      const { dir, env } = await open(owner)
      await env.writeFile(planDraftPath(dir), withTrailingNewline(body))
    },
    async writeSnapshot(owner, version, body) {
      const { dir, env } = await open(owner)
      await env.writeFile(planSnapshotPath(dir, version), withTrailingNewline(body))
    },
  }
}

const withTrailingNewline = (text: string) => (text.endsWith('\n') ? text : `${text}\n`)
