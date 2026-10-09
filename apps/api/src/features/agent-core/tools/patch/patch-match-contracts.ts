export interface MatchCandidate {
  index: number
  length: number
}

export type MatchStrategy =
  | 'exact'
  | 'trailing-whitespace'
  | 'indentation'
  | 'trimmed'
  | 'punctuation'
  | 'whitespace'
  | 'block-anchor'
  | 'fuzzy'

export interface PatchMatch {
  index: number
  length: number
  exact: boolean
  strategy: MatchStrategy
}

export type StrategyFinder = (
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  limit: number,
) => MatchCandidate[]

export type UniqueMatchResult =
  | { kind: 'match'; match: PatchMatch }
  | { kind: 'ambiguous'; strategy: MatchStrategy; count: number }
  | { kind: 'none' }
