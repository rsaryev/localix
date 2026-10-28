import { installedExecutable } from './lsp-installer'
import { LSP_PACKAGES } from './lsp-registry'

/**
 * WHAT A PLUGIN'S LSP `command` NEEDS WHEN IT IS NOT ON PATH. Claude Code's LSP plugins name a
 * server and assume someone installed it (`npm i -g …`, `go install …`). Localix assumes no Node
 * and no npm: a command one of its packages provides (`bin` in `language-servers.json`) is
 * installed on first use through the same installer as the built-in servers
 * (`lsp-installer.ts`), and an npm one always runs with Localix's own Bun. A command it cannot
 * install gets the toolchain it needs named instead.
 */

export interface CommandInstall {
  /** The package in `language-servers.json`. */
  package: string
  /** An npm package bin, run with Bun from the install's `node_modules/.bin`. */
  npmBin?: string
  /** An executable inside the install. */
  executable?: (installDir: string) => string
}

const INSTALLS: ReadonlyMap<string, CommandInstall> = new Map(
  Object.values(LSP_PACKAGES).flatMap((pkg) =>
    pkg.bin.map((bin): [string, CommandInstall] => [
      bin,
      pkg.source.type === 'npm'
        ? { package: pkg.id, npmBin: bin }
        : {
            package: pkg.id,
            executable: (dir) => installedExecutable(pkg.source.type, bin, dir),
          },
    ]),
  ),
)

/** What a server Localix cannot install needs. Never a Node package manager. */
const TOOLCHAIN_HINTS: Readonly<Record<string, string>> = {
  clangd: 'needs clangd from LLVM (Xcode Command Line Tools on macOS, or your package manager)',
  jdtls: 'needs Java 21 or later and Eclipse JDT LS (brew install jdtls)',
  'kotlin-language-server':
    'needs a JDK and kotlin-language-server (brew install kotlin-language-server)',
  'lua-language-server': 'needs lua-language-server (brew install lua-language-server)',
  'sourcekit-lsp': 'needs Xcode or the Swift toolchain',
  'csharp-ls': 'needs the .NET SDK (dotnet tool install -g csharp-ls)',
  'ruby-lsp': 'needs Ruby (gem install ruby-lsp)',
}

/** A bare command name; a command given as a path is the plugin's own and is never replaced. */
const bareName = (command: string) => (/[\\/]/.test(command) ? undefined : command)

export function commandInstall(command: string): CommandInstall | undefined {
  const name = bareName(command)
  return name ? INSTALLS.get(name) : undefined
}

/** How the person reads a first-use install: Go builds gopls; everything else is downloaded. */
export function firstUseNote(install: CommandInstall): string {
  return LSP_PACKAGES[install.package]?.source.type === 'golang'
    ? 'Localix builds it with Go on first use'
    : 'Localix installs it on first use'
}

export function toolchainHint(command: string): string | undefined {
  return TOOLCHAIN_HINTS[command.split(/[\\/]/).pop() ?? command]
}
