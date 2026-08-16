/**
 * The `dsh` child-process manager: spawns the web profile, resolves its
 * readiness line into a URL, and owns stopping it. Node-only (no `vscode`
 * import), so the lifecycle is testable against a real child process.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { ResolvedLaunch } from './cli'
import { parseReadyLine } from './cli'

/** Options for {@link startServer}. */
export interface StartOptions {
  /** The resolved launch (command plus the argv that precedes the flags). */
  launch: ResolvedLaunch
  /** The profile flags appended after `launch.argsPrefix`. */
  flags: readonly string[]
  /** Working directory for the child; the harness treats this as its working directory. */
  cwd?: string
  /** Extra environment variables merged over `process.env` for the child. */
  env?: Readonly<Record<string, string>>
  /** Milliseconds to wait for the readiness line before failing. */
  timeoutMs?: number
  /** Receives raw child stdout/stderr text as it arrives. */
  onLog?: (text: string) => void
}

/** A running harness server: its URL plus the exit and stop contracts. */
export interface RunningServer {
  url: string
  port: number
  /** Resolves with the exit code (or `null` for a signal) once the child exits. */
  exitCode: Promise<number | null>
  /** Terminate the child, escalating to a hard kill after a grace period. */
  stop(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 5_000

/**
 * Spawn the harness and resolve once its readiness line has been printed.
 * Rejects when the child exits first, fails to spawn, or misses the timeout.
 * @param options - launch, flags, working directory, and logging.
 * @returns the running server handle.
 */
export function startServer(options: StartOptions): Promise<RunningServer> {
  const { launch, flags } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<RunningServer>((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      shell: launch.shell,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
    if (options.env !== undefined) {
      spawnOptions.env = { ...process.env, ...options.env }
    }
    const child: ChildProcess = spawn(
      launch.command,
      [...launch.argsPrefix, ...flags],
      spawnOptions,
    )

    let settled = false
    let log = ''

    const fail = (message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message}${log === '' ? '' : `\n${log.trimEnd()}`}`))
    }

    const timer = setTimeout(() => { fail(`dsh did not become ready within ${timeoutMs}ms`) }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    let lineBuffer = ''
    child.stdout?.on('data', (chunk: string) => {
      options.onLog?.(chunk)
      log += chunk
      lineBuffer += chunk
      for (;;) {
        const newline = lineBuffer.indexOf('\n')
        if (newline === -1) break
        const line = lineBuffer.slice(0, newline)
        lineBuffer = lineBuffer.slice(newline + 1)
        const ready = parseReadyLine(line)
        if (ready === undefined) continue
        settled = true
        clearTimeout(timer)
        resolve({
          url: `http://${ready.host}:${String(ready.port)}`,
          port: ready.port,
          exitCode: exitPromise,
          stop,
        })
        return
      }
    })
    child.stderr?.on('data', (chunk: string) => {
      options.onLog?.(chunk)
      log += chunk
    })

    child.on('error', (error: Error) => {
      // A spawn failure surfaces as an 'error' event, not an 'exit'.
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    const exitPromise = new Promise<number | null>((resolveExit) => {
      child.on('exit', (code, signal) => {
        if (!settled) {
          fail(`dsh exited before printing its readiness line (code ${String(code)}, signal ${String(signal)})`)
          return
        }
        resolveExit(code)
      })
    })

    function stop(): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      return new Promise<void>((resolveStop) => {
        const force = setTimeout(() => { child.kill('SIGKILL') }, STOP_GRACE_MS)
        child.once('exit', () => {
          clearTimeout(force)
          resolveStop()
        })
        child.kill('SIGTERM')
      })
    }
  })
}
