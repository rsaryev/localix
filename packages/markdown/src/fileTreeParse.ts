/**
 * Reading a ```tree fence: the directory layout models already draw with box characters, as rows
 * a renderer can lay out (`FileTree.tsx`).
 *
 *   src/
 *   ├── app.ts          # entry point
 *   └── features/
 *       └── chat/
 *
 * Depth is the number of 4-column guides (`│   ` or four spaces) before a branch (`├── ` /
 * `└── `); a line with no branch is a root. A row is a FOLDER when its name ends with `/` or the
 * next row is deeper. A comment — after `#`, or after a run of two or more spaces — is set apart
 * from the name. A line the grammar does not fit is kept as a plain row at its depth, so a tree
 * still reads when a model draws it slightly off.
 */
export interface TreeRow {
  depth: number
  name: string
  comment: string
  folder: boolean
  /** The row's place in the tree, `src/app/App.tsx` — a stable key for focus and collapse. */
  path: string
  /** The nearest shallower row above it; null at the top level. */
  parent: number | null
}

const GUIDE = /^(?:│ {3}|\| {3}| {4})/
const BRANCH = /^(?:├──|└──|\|--|`--|\+--)\s?/

function readLine(line: string): Pick<TreeRow, 'depth' | 'name' | 'comment'> | null {
  let rest = line.replace(/\s+$/, '')
  if (!rest.trim()) return null
  let depth = 0
  while (GUIDE.test(rest)) {
    rest = rest.replace(GUIDE, '')
    depth++
  }
  const branch = BRANCH.exec(rest)
  if (branch) {
    rest = rest.slice(branch[0].length)
    depth++
  } else rest = rest.trimStart()
  const commentAt = rest.search(/\s+#|\s{2,}/)
  const name = (commentAt === -1 ? rest : rest.slice(0, commentAt)).trim()
  const comment =
    commentAt === -1
      ? ''
      : rest
          .slice(commentAt)
          .replace(/^\s*#?\s*/, '')
          .trim()
  return { depth, name, comment }
}

export function parseFileTree(source: string): TreeRow[] {
  const rows = source.split('\n').flatMap((line) => {
    const row = readLine(line)
    return row ? [row] : []
  })
  const parsed: TreeRow[] = []
  const plain: string[] = []
  rows.forEach((row, index) => {
    let parent: number | null = null
    for (let above = index - 1; above >= 0; above--)
      if (rows[above]!.depth < row.depth) {
        parent = above
        break
      }
    plain.push(`${parent === null ? '' : `${plain[parent]!.replace(/\/$/, '')}/`}${row.name}`)
    parsed.push({
      ...row,
      folder: row.name.endsWith('/') || (rows[index + 1]?.depth ?? 0) > row.depth,
      // Two rows may share a path when a model repeats a name; the index keeps the key unique.
      path: `${plain[index]}#${index}`,
      parent,
    })
  })
  return parsed
}
