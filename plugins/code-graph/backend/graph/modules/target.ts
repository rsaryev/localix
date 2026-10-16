/**
 * Where an import specifier leads: a project file, a project directory (a Go package, a Python
 * namespace package), a dependency outside the project, or nowhere known.
 *
 * `null` is a real answer — a relative import of a file that does not exist, a generated module —
 * and is counted as unresolved rather than turned into a guess: an edge to the wrong file is worse
 * than a missing one, because nothing on the map says it is wrong.
 */
export type ModuleTarget =
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string }
  | { kind: 'package'; name: string }

/** The project's files and the directories that contain them, for existence checks. */
export interface ProjectFiles {
  files: ReadonlySet<string>
  dirs: ReadonlySet<string>
}

export function projectFiles(paths: Iterable<string>): ProjectFiles {
  const files = new Set(paths)
  const dirs = new Set<string>([''])
  for (const path of files) {
    for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) {
      const dir = path.slice(0, slash)
      if (dirs.has(dir)) break
      dirs.add(dir)
    }
  }
  return { files, dirs }
}
