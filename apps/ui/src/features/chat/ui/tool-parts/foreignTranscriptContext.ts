import { createContext, useContext } from 'react'

/**
 * Marks the surrounding transcript as belonging to a FOREIGN agent — a Claude
 * Code / Codex / opencode history we only read off disk, never a run of ours.
 *
 * Foreign transcripts carry tools whose NAMES collide with ours (`read`,
 * `bash`, `search`) over payloads that share nothing with our contracts. Our
 * rich cards pick those payloads apart field by field, so rendering one against
 * a foreign call is not a soft degrade — it is a confident wrong answer: a file
 * card naming no file, a terminal card showing no command, and no error
 * anywhere to say the reading was invented. Default false so every ordinary
 * transcript keeps its rich cards; the surface replaying someone else's history
 * provides true.
 */
export const ForeignTranscriptContext = createContext(false)

/** True when the transcript being rendered belongs to an agent other than ours. */
export function useIsForeignTranscript(): boolean {
  return useContext(ForeignTranscriptContext)
}
