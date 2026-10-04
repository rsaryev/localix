import type { SourceControlStatus } from '../../../../backend/source-control/contracts'

/**
 * A string that changes whenever the focused repo's HEAD plausibly moved — the key a view uses
 * to decide whether a re-show must re-read what it derived from HEAD (the log, the HEAD message,
 * the PR list).
 *
 * The defect it prevents: those views re-read unconditionally every time their tab was shown
 * again, which for the PR list is a `gh` CLI round trip per tab switch. A view now re-reads only
 * when this stamp differs from the one its last read saw.
 *
 * `logVersion` covers every ref-moving write made through the store. A commit made OUTSIDE the
 * panel (an agent, a terminal) is visible only through the polled status, which carries HEAD's
 * sha: without it the stamp had to infer a move from ahead/behind and the file count, and an
 * `--amend -m` on a clean tree without an upstream moved neither.
 */
export function headStamp(status: SourceControlStatus | null, logVersion: number): string {
  if (!status) return `none|${logVersion}`
  return [
    status.root ?? '',
    status.head ?? '',
    status.branch ?? '',
    status.detached ? 'detached' : '',
    status.ahead,
    status.behind,
    status.files.length,
    status.rebase?.step ?? '',
    status.bisect?.current?.hash ?? '',
    logVersion,
  ].join('|')
}
