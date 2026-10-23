import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { ActionFeedback, useActionFeedback } from '@localixai/kit/action-feedback'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { SearchInput } from '@localixai/kit/search-input'
import { SectionLabel } from '@localixai/kit/section-label'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { BranchDraft, BranchRow, RemoteBranchRow } from './BranchRow'
import { BulkAction } from './sourceControlParts'
import { filterBranches } from './branchFilter'
import { useBranchSwitcher } from './useBranchSwitcher'

/**
 * The size at which a flat list stops being a list and becomes a haystack. Below
 * it the filter box would be chrome over something you can already read.
 */
const FILTER_THRESHOLD = 6

/**
 * How many remote-only branches to show before the filter is used.
 *
 * A busy repo has dozens of them (this one has 13 against 2 local), and dumping
 * every one below the branches you actually work on buries the section it is
 * appended to. They are a place to GO looking, not a list to read: the few most
 * recent, then a line saying how many more the filter would find.
 */
const REMOTE_PREVIEW = 5

/**
 * Branch management, on the surface where a branch NAME can be typed.
 *
 * It used to live in a popover hung off the composer's branch pill, and moved here when that pill
 * became a declared status item. That was right for SWITCHING — a list of names is a menu, and the
 * titlebar item offers exactly that — but three of the four operations come with a text field, and
 * a status menu is data: `MenuEntry` has a label and an `onSelect`, and no way to ask for a
 * string. So creating, renaming and deleting moved to the panel. The seam's own rule, applied: a
 * mini app that needs arbitrary graphics gets a panel, not a strip of chrome.
 *
 * The popover version carried ~80 lines of roving-focus code — a selectable-item query, an
 * arrow-key mover, a restore-focus ref — because a popover is a focus trap that has to implement
 * navigation itself. A section in document flow gets Tab order from the browser, so none of that
 * came with it.
 *
 * Every operation is {@link useBranchSwitcher}'s, unchanged. It already owns the refusals that
 * matter — a branch held by another worktree cannot be checked out or deleted, the current branch
 * cannot be deleted, an unmerged delete offers a forced retry — and this file only asks.
 */
export function BranchesSection({ sessionId }: { sessionId: string | null }) {
  const feedback = useActionFeedback()
  const {
    list,
    remotes,
    currentBranch,
    switching,
    busy,
    isPending,
    onPick,
    onCreate,
    onRename,
    onDelete,
    onMerge,
    onCheckoutRemote,
  } = useBranchSwitcher(sessionId, feedback)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const current = currentBranch
  // A remote branch is a candidate to CREATE locally, so it is ranked on the
  // name you would type — `feature/x`, not `origin/feature/x`.
  const visibleLocal = useMemo(() => filterBranches(list, query, current), [list, query, current])
  const visibleRemotes = useMemo(
    () =>
      filterBranches(
        remotes.map((r) => ({ ...r, name: r.shortName })),
        query,
      ),
    [remotes, query],
  )
  const showFilter = list.length + remotes.length > FILTER_THRESHOLD
  // Unfiltered, the remote group is a preview; a query means you are hunting, so
  // it opens up.
  const remoteOverflow = query.trim() ? 0 : Math.max(0, visibleRemotes.length - REMOTE_PREVIEW)
  const shownRemotes = remoteOverflow > 0 ? visibleRemotes.slice(0, REMOTE_PREVIEW) : visibleRemotes

  // No branches and no remotes means no commits yet: nothing to list, nothing to switch to.
  if (list.length === 0 && remotes.length === 0) return null

  const startCreate = () => {
    setRenaming(null)
    setDraft('')
    setCreating(true)
  }

  const startRename = (name: string) => {
    setCreating(false)
    setDraft(name)
    setRenaming(name)
  }

  const cancel = () => {
    setCreating(false)
    setRenaming(null)
    setDraft('')
  }

  const submit = async () => {
    const name = draft.trim()
    if (!name) return cancel()
    const ok = creating ? await onCreate(name) : renaming ? await onRename(renaming, name) : false
    if (ok) cancel()
  }

  const nothingMatched = query.trim() && visibleLocal.length === 0 && visibleRemotes.length === 0

  return (
    <CollapsibleSection
      title="Branches"
      // The LOCAL count. Folding the remote-only ones in read as "15 branches"
      // for a repo with two — the section is about the branches you have, and the
      // remote group below says how many more there are to fetch down.
      count={list.length}
      defaultOpen={false}
      actions={
        <>
          {/* "Already exists", "Merged x": the answer to a branch action, beside the section. */}
          <ActionFeedback store={feedback} className="max-w-48" />
          <BulkAction title="New branch" onClick={startCreate} disabled={busy}>
            <Plus className="size-3.5" />
          </BulkAction>
        </>
      }
    >
      {showFilter && (
        // `pb-1` only: the section header above already carries its own `py-1`,
        // and adding a second one opened a band of dead space over the first row
        // that no other section has. The field itself is the shared `SearchInput`
        // — the first draft hand-placed a Search icon and a clear button absolutely
        // inside a plain Input, which is the parallel variant this repo keeps one
        // primitive to avoid: it sat on its own geometry and lost focus on clear.
        <div className="px-2 pb-1">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Filter branches…"
            aria-label="Filter branches"
            size="md"
            inset
            // Escape clears rather than blurs: the field exists to narrow a list,
            // and getting the whole list back is the only thing to undo.
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
          />
        </div>
      )}
      {creating && (
        <BranchDraft
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onCancel={cancel}
          placeholder="New branch name"
          busy={busy}
        />
      )}
      {visibleLocal.map((branch) =>
        renaming === branch.name ? (
          <BranchDraft
            key={branch.name}
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onCancel={cancel}
            placeholder="New name"
            busy={busy}
          />
        ) : (
          <BranchRow
            key={branch.name}
            branch={branch}
            isCurrent={branch.name === current}
            currentBranch={current}
            switching={switching === branch.name}
            pending={isPending(branch.name)}
            query={query}
            onPick={() => void onPick(branch.name)}
            onRename={() => startRename(branch.name)}
            onDelete={() => onDelete(branch.name)}
            onMerge={(noFastForward) => onMerge(branch.name, noFastForward)}
          />
        ),
      )}
      {visibleRemotes.length > 0 && (
        <>
          {/* The shared section heading, not a hand-rolled uppercase div — it is the
              same kind of label the section header above uses, so it should be the
              same one. A hairline separates the two groups without adding height. */}
          <SectionLabel
            weight="semibold"
            className="mt-1 border-t border-border-soft px-2 pb-0.5 pt-1.5"
          >
            Remote only
          </SectionLabel>
          {shownRemotes.map((branch) => (
            <RemoteBranchRow
              key={branch.remote + '/' + branch.shortName}
              name={`${branch.remote}/${branch.shortName}`}
              shortName={branch.shortName}
              updatedAt={branch.updatedAt}
              pending={isPending(`${branch.remote}/${branch.shortName}`)}
              query={query}
              onCheckout={() => onCheckoutRemote(`${branch.remote}/${branch.shortName}`)}
            />
          ))}
          {remoteOverflow > 0 && (
            <p className="px-2 pb-1 pt-0.5 text-2xs text-text-faint">
              {remoteOverflow} more on the remote — filter to find one.
            </p>
          )}
        </>
      )}
      {nothingMatched && (
        <EmptyHint className="justify-start px-2 py-2 text-2xs">
          No branch matches “{query.trim()}”.
        </EmptyHint>
      )}
    </CollapsibleSection>
  )
}
