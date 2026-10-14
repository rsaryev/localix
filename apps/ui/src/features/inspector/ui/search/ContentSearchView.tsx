/**
 * ContentSearchView — the content-search (find-in-files) controls + result tree,
 * rendered INSIDE the Files tree panel when its search field is in "text" mode.
 * The query input itself lives in the tree panel header (shared with the filename
 * filter); this view adds the match toggles, include/exclude globs, context lines,
 * the Replace row (with live inline preview) and the folder→file→match results.
 *
 * Extracted from the former standalone SearchPanel so no search capability is lost
 * now that Search is folded into the tree. Backed by {@link useContentSearch}.
 */
import { EyeOff, Replace, SlidersHorizontal } from 'lucide-react'
import { ActionFeedback } from '@localixai/kit/action-feedback'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@localixai/kit/input-group'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { ProblemLine } from '@/shared/ui/problem-report'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { ContentSearch } from './useContentSearch'
import { ContextLinesField, GlobField, Toggle } from './SearchTreeView'
import { SearchResultsTree } from './SearchResultsTree'

export function ContentSearchView({ cs, query }: { cs: ContentSearch; query: string }) {
  const trimmed = query.trim()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls stack — every row is full-width and aligned to the same px-2
          gutter as the query field in the panel header above, so the find input,
          option toggles, replace input and glob fields all line up. */}
      <WorkbenchToolbar
        as="header"
        layout="stacked"
        tone="sidebar"
        aria-label="Content search options"
        className="gap-1.5 px-2"
      >
        {/* Options row: match toggles (left) + details / replace disclosures (right).
            The query field itself lives in the panel header. */}
        <div className="flex h-[var(--chrome-control-xs)] items-center gap-0.5">
          <Toggle
            active={cs.caseSensitive}
            onClick={() => cs.setCaseSensitive(!cs.caseSensitive)}
            title="Match case"
          >
            Aa
          </Toggle>
          <Toggle
            active={cs.wholeWord}
            onClick={() => cs.setWholeWord(!cs.wholeWord)}
            title="Match whole word"
          >
            ab
          </Toggle>
          <Toggle
            active={cs.regex}
            onClick={() => cs.setRegex(!cs.regex)}
            title="Use regular expression"
          >
            .*
          </Toggle>
          <Toggle
            active={cs.includeIgnored}
            onClick={() => cs.setIncludeIgnored(!cs.includeIgnored)}
            title="Search .gitignored files (incl. nested repos hidden by a parent repo's .gitignore)"
          >
            <EyeOff className="size-3" />
          </Toggle>
          <WorkbenchToolbarSection align="end" spacing="compact" aria-label="Search disclosures">
            <Toggle
              active={cs.showDetails || !!cs.includeGlob || !!cs.excludeGlob || cs.contextLines > 0}
              onClick={() => cs.setShowDetails(!cs.showDetails)}
              title="Toggle search details (include / exclude globs, context lines)"
            >
              <SlidersHorizontal className="size-3" />
            </Toggle>
            <Toggle
              active={cs.showReplace}
              onClick={() => cs.setShowReplace(!cs.showReplace)}
              title="Toggle Replace"
            >
              <Replace className="size-3" />
            </Toggle>
          </WorkbenchToolbarSection>
        </div>
        {cs.showReplace && (
          // No fill override: InputGroup's own `--input` veil is the standard field fill.
          // Forcing `bg-background` painted the pane's dark ground as a black bar.
          <InputGroup>
            <InputGroupAddon>
              <Replace />
            </InputGroupAddon>
            <InputGroupInput
              value={cs.replaceText}
              onChange={(e) => cs.setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cs.hasResults && !cs.replacing) {
                  e.preventDefault()
                  cs.setConfirmReplace(true)
                }
              }}
              placeholder="Replace"
              spellCheck={false}
              aria-label="Replacement text"
              className="text-2xs"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="xs"
                disabled={!cs.hasResults || cs.replacing}
                onClick={() => cs.setConfirmReplace(true)}
                aria-label="Replace all"
                title="Replace all"
              >
                <Replace />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
        {/* The replace-all answer, under the field that asked for it; empty between answers. */}
        {cs.showReplace && <ActionFeedback store={cs.replaceFeedback} className="px-1" />}
        {cs.showDetails && (
          <div className="space-y-2">
            <GlobField
              label="files to include"
              value={cs.includeGlob}
              onChange={cs.setIncludeGlob}
              placeholder="e.g. *.ts, src/**"
            />
            <GlobField
              label="files to exclude"
              value={cs.excludeGlob}
              onChange={cs.setExcludeGlob}
              placeholder="e.g. *.test.ts, dist/**"
            />
            <ContextLinesField value={cs.contextLines} onChange={cs.setContextLines} />
          </div>
        )}
      </WorkbenchToolbar>
      {trimmed && !(cs.loading && cs.matches.length === 0) && (
        <WorkbenchStatusBar aria-label="Content search summary" seam="bottom" tone="sidebar">
          <WorkbenchStatusItem className="max-w-full">
            {cs.matches.length === 0 ? (
              // "No results." is a claim about the PROJECT, so it may only be made when
              // the search actually ran. When it did not, the row is a ProblemLine — one
              // sentence plus "Details", where the engine's exact complaint is waiting.
              cs.problem ? (
                <ProblemLine {...cs.problem} />
              ) : (
                'No results.'
              )
            ) : (
              `${cs.truncated ? `${cs.matches.length}+` : cs.matches.length} result${cs.matches.length === 1 ? '' : 's'} in ${cs.fileCount} file${cs.fileCount === 1 ? '' : 's'}`
            )}
          </WorkbenchStatusItem>
        </WorkbenchStatusBar>
      )}
      <SearchResultsTree cs={cs} />
      <ConfirmDialog
        open={cs.confirmReplace}
        variant="destructive"
        title="Replace all occurrences?"
        description={`This rewrites ${cs.matches.length} match${cs.matches.length === 1 ? '' : 'es'} across ${cs.fileCount} file${cs.fileCount === 1 ? '' : 's'} with "${cs.replaceText}". This edits files on disk and cannot be undone from here.`}
        confirmLabel="Replace all"
        onConfirm={() => {
          cs.setConfirmReplace(false)
          void cs.runReplace()
        }}
        onClose={() => cs.setConfirmReplace(false)}
      />
    </div>
  )
}
