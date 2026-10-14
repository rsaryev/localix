import type {
  ExecutionEnvironment,
  ExecutionEnvironmentConfig,
  SearchFilesOptions,
} from '../environment'
import { interpretRipgrep, shellQuote } from '../environment'
import { buildRipgrepCommand } from './ripgrep'
import { spawnToResult } from './spawn'

// The ssh/docker ripgrep invocation is rendered by the SHARED builder
// (`buildRipgrepCommand` in ../environment) — the same flag set the local backend
// spawns as argv, quoted for `bash -c`. It used to be a hand-rolled copy here whose
// comment claimed it "mirrors local searchFiles' flag set" while silently omitting
// `--multiline`, so a multi-line pattern that searched fine locally hard-errored
// (rg exit 2) on these backends. The copy is gone; divergence is now unexpressible.

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------

export class SSHEnvironment implements ExecutionEnvironment {
  readonly config: ExecutionEnvironmentConfig

  constructor(config: ExecutionEnvironmentConfig) {
    if (config.kind !== 'ssh') throw new Error('SSHEnvironment requires kind=ssh')
    this.config = config
  }

  private sshArgs(extraArgs: string[] = []): string[] {
    const host = this.config.sshHost!
    const port = this.config.sshPort ?? 22
    return [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'BatchMode=yes',
      '-p',
      String(port),
      ...extraArgs,
      host,
    ]
  }

  async exec(
    command: string,
    opts?: { cwd?: string; timeout?: number; uncapped?: boolean; signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const remoteCmd = opts?.cwd ? `cd ${shellQuote(opts.cwd)} && ${command}` : command
    const args = [...this.sshArgs(), `bash -c ${shellQuote(remoteCmd)}`]
    return spawnToResult('ssh', args, {
      timeout: opts?.timeout,
      uncapped: opts?.uncapped,
      signal: opts?.signal,
    })
  }

  async readFile(filePath: string): Promise<string> {
    // uncapped: a file read must return the COMPLETE content (the command-output
    // tail cap would silently truncate a large file to its last 2MB).
    const result = await this.exec(`cat ${shellQuote(filePath)}`, { uncapped: true })
    if (result.exitCode !== 0) {
      throw new Error(`SSH readFile failed for ${filePath}: ${result.stderr}`)
    }
    return result.stdout
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    // Ensure parent dir exists, then stream content via stdin.
    //
    // DISPOSITION (dormant): this write is NON-ATOMIC — `cat > path` truncates the
    // target the instant it opens, so a dropped connection / timeout / kill mid-stream
    // leaves a partial (corrupt) file at the REAL path, with no recovery. A local write
    // uses atomicWriteFile (temp + rename); the exec-based backends do not. This is
    // acceptable ONLY because these backends are unwired — no code path sets a session's
    // executionBackend to 'ssh'/'docker' (createSession/external-sessions/branching-ops
    // all write 'local'), so SSHEnvironment/DockerEnvironment are never instantiated
    // outside tests. BEFORE enabling remote execution, make this atomic: write to a
    // temp path and `mv` it into place over exec (a quoting-careful change), so a
    // partial transfer never corrupts the destination.
    const dir = filePath.replace(/\/[^/]+$/, '') || '/'
    const args = [...this.sshArgs(), `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(filePath)}`]
    const result = await spawnToResult('ssh', args, { stdinContent: content })
    if (result.exitCode !== 0) {
      throw new Error(`SSH writeFile failed for ${filePath}: ${result.stderr}`)
    }
  }

  async searchFiles(pattern: string, cwd: string, opts?: SearchFilesOptions): Promise<string> {
    const result = await this.exec(buildRipgrepCommand(pattern, cwd, opts), {
      signal: opts?.signal,
      ...(opts?.timeoutSeconds ? { timeout: opts.timeoutSeconds } : {}),
    })
    return interpretRipgrep(result)
  }
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

export class DockerEnvironment implements ExecutionEnvironment {
  readonly config: ExecutionEnvironmentConfig

  constructor(config: ExecutionEnvironmentConfig) {
    if (config.kind !== 'docker') throw new Error('DockerEnvironment requires kind=docker')
    this.config = config
  }

  private get container(): string {
    return this.config.containerName!
  }

  async exec(
    command: string,
    opts?: { cwd?: string; timeout?: number; uncapped?: boolean; signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const remoteCmd = opts?.cwd ? `cd ${shellQuote(opts.cwd)} && ${command}` : command
    const args = ['exec', this.container, 'bash', '-c', remoteCmd]
    return spawnToResult('docker', args, {
      timeout: opts?.timeout,
      uncapped: opts?.uncapped,
      signal: opts?.signal,
    })
  }

  async readFile(filePath: string): Promise<string> {
    // uncapped: a file read must return the COMPLETE content (the command-output
    // tail cap would silently truncate a large file to its last 2MB).
    const result = await this.exec(`cat ${shellQuote(filePath)}`, { uncapped: true })
    if (result.exitCode !== 0) {
      throw new Error(`Docker readFile failed for ${filePath}: ${result.stderr}`)
    }
    return result.stdout
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    // NON-ATOMIC, dormant — same disposition as SSHEnvironment.writeFile above:
    // `cat > path` truncates on open, so a mid-stream failure corrupts the real file.
    // Safe only because no session ever runs on the docker backend; make it atomic
    // (temp + `mv`) before wiring it.
    const dir = filePath.replace(/\/[^/]+$/, '') || '/'
    // docker exec -i container sh -c 'mkdir -p dir && cat > path'
    const args = [
      'exec',
      '-i',
      this.container,
      'sh',
      '-c',
      `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(filePath)}`,
    ]
    const result = await spawnToResult('docker', args, { stdinContent: content })
    if (result.exitCode !== 0) {
      throw new Error(`Docker writeFile failed for ${filePath}: ${result.stderr}`)
    }
  }

  async searchFiles(pattern: string, cwd: string, opts?: SearchFilesOptions): Promise<string> {
    const result = await this.exec(buildRipgrepCommand(pattern, cwd, opts), {
      signal: opts?.signal,
      ...(opts?.timeoutSeconds ? { timeout: opts.timeoutSeconds } : {}),
    })
    return interpretRipgrep(result)
  }
}
