import { useEffect, useMemo, useState } from 'react'
import { acknowledgeInline, type MenuEntry } from '@localixai/mini-app-sdk/ui'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'

import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'

import type {
  ReaderSearchMatch,
  ReaderSearchOptions,
  ReaderSearchResponse,
  ReaderSource,
} from '../shared/contracts'
import { readerFileName } from '../shared/formats'
import { DEFAULT_READER_SEARCH_OPTIONS, type ReaderSearchMode } from '../shared/search'
import { ReaderApiError, readerApi } from './api'
import { useReaderProblem } from './problems'
import { choiceSubmenu, type ReaderMenuChoice } from './choiceSubmenu'

const MODE_CHOICES: readonly ReaderMenuChoice<ReaderSearchMode>[] = [
  { value: 'contains', label: 'Contains', description: 'The phrase anywhere in the text' },
  {
    value: 'whole-words',
    label: 'Whole words',
    description: 'Only where it stands as whole words',
  },
  {
    value: 'nearby-words',
    label: 'Nearby words',
    description: 'All the words, within a few of each other',
  },
  { value: 'regex', label: 'Regular expression', description: 'A pattern, matched as written' },
]

const MODE_LABELS = Object.fromEntries(
  MODE_CHOICES.map((choice) => [choice.value, choice.label]),
) as Record<ReaderSearchMode, string>

type SearchOptions = Omit<ReaderSearchOptions, 'query'>

/**
 * The search options as the app's menu.
 *
 * The defect it replaces: Radix radio groups for scope and match mode, and — when "Nearby words"
 * was chosen — a row of hand-drawn 5/10/20 chips placed INSIDE the menu, with their own hover and
 * active colours and no menu keyboard behaviour. Scope, match and distance are now submenu rows
 * whose hints are the current picks; match case and diacritics are real on/off toggles, so they
 * stay `checked`.
 */
function searchOptionEntries(
  options: SearchOptions,
  patchOptions: (patch: Partial<SearchOptions>) => void,
): MenuEntry[] {
  return [
    choiceSubmenu<SearchOptions['scope']>({
      id: 'scope',
      label: 'Scope',
      current: options.scope,
      choices: [
        { value: 'book', label: 'Whole book' },
        { value: 'chapter', label: 'Current chapter' },
      ],
      onPick: (scope) => patchOptions({ scope }),
    }),
    choiceSubmenu({
      id: 'match',
      label: 'Match',
      current: options.mode,
      choices: MODE_CHOICES,
      onPick: (mode) => patchOptions({ mode }),
    }),
    ...(options.mode === 'nearby-words'
      ? [
          choiceSubmenu({
            id: 'within',
            label: 'Within',
            current: options.nearbyWords,
            choices: [5, 10, 20].map((value) => ({ value, label: `${value} words` })),
            onPick: (nearbyWords) => patchOptions({ nearbyWords }),
          }),
        ]
      : []),
    { separator: true },
    {
      id: 'match-case',
      label: 'Match case',
      checked: options.matchCase,
      onSelect: () => patchOptions({ matchCase: !options.matchCase }),
    },
    {
      id: 'match-diacritics',
      label: 'Match diacritics',
      checked: options.matchDiacritics,
      disabled: options.mode === 'regex',
      onSelect: () => patchOptions({ matchDiacritics: !options.matchDiacritics }),
    },
  ]
}

interface ReaderSearchPanelProps {
  source: ReaderSource
  currentChapter: number
  activeMatchId: string | null
  onNavigate: (match: ReaderSearchMatch) => void
}

export function ReaderSearchPanel({
  source,
  currentChapter,
  activeMatchId,
  onNavigate,
}: ReaderSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_READER_SEARCH_OPTIONS)
  const [result, setResult] = useState<ReaderSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null)
  const minimum = options.mode === 'regex' ? 1 : 2
  useEffect(() => {
    const value = query.trim()
    if (value.length < minimum) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void readerApi
        .search(
          source,
          {
            query: value,
            ...options,
            ...(options.scope === 'chapter' ? { chapter: currentChapter } : {}),
          },
          controller.signal,
        )
        .then((next) => setResult(next))
        .catch((cause) => {
          if (controller.signal.aborted) return
          setResult(null)
          acknowledgeInline(cause)
          // A rejected regular expression IS the useful sentence, and the route's own message is
          // already one. Anything else is a transport throw, which is not.
          setError(
            cause instanceof ReaderApiError
              ? { message: cause.message, detail: cause.detail ?? undefined }
              : { message: 'The search could not run.', detail: String(cause) },
          )
        })
        .finally(() => !controller.signal.aborted && setLoading(false))
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [currentChapter, minimum, options, query, source])

  // Owned here, above the branch that draws it: the branch is gone the moment a search works.
  const searchProblem = useReaderProblem(
    { label: `${readerFileName(source)} search` },
    error?.message,
    { detail: error?.detail },
  )

  const matches = useMemo(() => result?.groups.flatMap((group) => group.matches) ?? [], [result])
  const activeIndex = activeMatchId ? matches.findIndex((match) => match.id === activeMatchId) : -1
  const move = (offset: number) => {
    if (!matches.length) return
    const base = activeIndex < 0 ? (offset > 0 ? -1 : 0) : activeIndex
    const index = (base + offset + matches.length) % matches.length
    const match = matches[index]
    if (match) onNavigate(match)
  }

  const patchOptions = (patch: Partial<SearchOptions>) =>
    setOptions((current) => ({ ...current, ...patch }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--reader-rule)] p-2">
        <div className="flex items-center gap-1">
          {/* The kit field, not a hand-placed icon + Input + clear button: this was the host's
              SearchInput rebuilt by hand, with its own clear-button geometry. */}
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search this book"
            aria-label="Search inside book"
            autoFocus
            className="min-w-0 flex-1"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Book search options" tooltip="Search options">
                <SlidersHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <MenuEntries entries={searchOptionEntries(options, patchOptions)} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-1.5 flex min-h-[var(--chrome-control-sm)] items-center gap-1 text-2xs text-text-faint">
          <span className="min-w-0 flex-1 truncate">
            {loading
              ? 'Searching…'
              : result
                ? `${result.total}${result.truncated ? '+' : ''} results · ${options.scope === 'book' ? 'book' : 'chapter'}`
                : query.trim().length > 0 && query.trim().length < minimum
                  ? `Enter at least ${minimum} characters`
                  : MODE_LABELS[options.mode]}
          </span>
          {matches.length > 0 && (
            <>
              <span className="tabular-nums">
                {activeIndex < 0 ? '–' : activeIndex + 1}/{matches.length}
              </span>
              <IconButton
                size="sm"
                onClick={() => move(-1)}
                aria-label="Previous search result"
                tooltip="Previous result"
              >
                <ChevronUp />
              </IconButton>
              <IconButton
                size="sm"
                onClick={() => move(1)}
                aria-label="Next search result"
                tooltip="Next result"
              >
                <ChevronDown />
              </IconButton>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 scrollbar-thin" aria-live="polite">
        {loading && !result ? (
          <LoadingHint>Searching book…</LoadingHint>
        ) : error ? (
          // The results area is empty BECAUSE the search failed; that is a report, not a hint.
          <div className="px-3">{searchProblem && <ProblemLine {...searchProblem} />}</div>
        ) : !result ? (
          <EmptyHint className="px-3">Find a phrase, term, or regular expression.</EmptyHint>
        ) : result.total === 0 ? (
          <EmptyHint className="px-3">No passages match this search.</EmptyHint>
        ) : (
          result.groups.map((group) => (
            <section key={group.chapter} className="mb-3">
              {/* `/95`, not plain `bg-background`: under glass the nested ground coat is cleared
                  by the once-only rule (matches bled through the sticky chapter row); the alpha
                  variant escapes it and keeps the occluding pane-hue coat. */}
              <div className="lx-occluder sticky top-0 z-(--z-sticky) flex items-center justify-between px-2 py-1 text-2xs font-medium text-text-faint">
                <span className="truncate">{group.chapterTitle}</span>
                <span className="ml-2 tabular-nums">{group.matches.length}</span>
              </div>
              {group.matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  aria-current={activeMatchId === match.id ? 'location' : undefined}
                  className="reader-search-result block w-full rounded-md px-2 py-2 text-left text-xs/5 text-text-soft outline-none hover:bg-surface-hover hover:text-foreground focus-ring aria-[current=location]:bg-surface-active aria-[current=location]:text-foreground"
                  onClick={() => onNavigate(match)}
                >
                  <span className="line-clamp-3">
                    {match.before && <span className="text-text-faint">…{match.before} </span>}
                    <mark>{match.match}</mark>
                    {match.after && <span className="text-text-faint"> {match.after}…</span>}
                  </span>
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
