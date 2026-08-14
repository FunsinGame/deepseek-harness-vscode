/**
 * `dsh` CLI resolution and web-profile argument assembly, kept free of any
 * `vscode` import so the launch decision is unit-testable and the extension
 * host glue stays a thin shell over this module.
 */

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The web-profile flags the extension always passes. */
export interface WebFlags {
  host: string
  port: number
}

/** A resolved launch: a command plus the argv that precedes the profile flags. */
export interface ResolvedLaunch {
  command: string
  argsPrefix: readonly string[]
  /** Whether the platform needs a shell to resolve the command (a bare `dsh` on Windows). */
  shell: boolean
}

/** The settings and environment facts the resolver reads. */
export interface ResolveInput {
  /** The `dsh.cliPath` setting value; empty string means unset. */
  cliPath: string
  /** The `DSH_CLI` environment variable, if present. */
  envCli: string | undefined
  platform: NodeJS.Platform
  /** The `PATH` environment variable. */
  pathEnv: string | undefined
  /** Absolute path to a source-checkout build of `apps/cli/lib/bin.js`, if one exists. */
  devFallback: string | undefined
}

/** Build the `--profile web` argv vector from the extension's flags. */
export function buildProfileArgs(flags: WebFlags): string[] {
  return ['--profile', 'web', '--host', flags.host, '--port', String(flags.port)]
}

/** The readiness line the web app prints once the server has bound. */
const READY_LINE = /dsh web: http:\/\/([^/\s:]+):(\d+)/

/**
 * Parse the web app's readiness line into the loopback host and bound port.
 * @param line - one line of the child's stdout.
 * @returns the bound host and port, or `undefined` when the line is not the readiness signal.
 */
export function parseReadyLine(line: string): { host: string; port: number } | undefined {
  const match = READY_LINE.exec(line)
  if (match === null) return undefined
  const host = match[1]
  const port = match[2]
  if (host === undefined || port === undefined) return undefined
  const parsed = Number(port)
  if (!Number.isInteger(parsed)) return undefined
  return { host, port: parsed }
}

/** Launch an explicit JS entry through the system `node`, never the extension host's Electron node. */
function runNodeEntry(entry: string): ResolvedLaunch {
  return { command: 'node', argsPrefix: [entry], shell: false }
}

/** Whether `name` resolves as an executable file in any `PATH` entry. */
function findOnPath(name: string, pathEnv: string | undefined, platform: NodeJS.Platform): boolean {
  if (pathEnv === undefined || pathEnv === '') return false
  const extensions = platform === 'win32' ? ['', '.cmd', '.bat', '.exe'] : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    for (const ext of extensions) {
      if (existsSync(join(dir, `${name}${ext}`))) return true
    }
  }
  return false
}

/**
 * Resolve the launch to run, in precedence order: the `cliPath` setting, the
 * `DSH_CLI` environment variable, a source-checkout build beside this
 * extension, then `dsh` on `PATH`. Returns `undefined` when nothing resolves.
 * @param input - the resolution facts.
 * @returns the launch, or `undefined` when no `dsh` is available.
 */
export function resolveLaunch(input: ResolveInput): ResolvedLaunch | undefined {
  const explicit = input.cliPath !== '' ? input.cliPath : input.envCli
  if (explicit !== undefined && explicit !== '') return runNodeEntry(explicit)
  if (input.devFallback !== undefined && existsSync(input.devFallback)) return runNodeEntry(input.devFallback)
  if (findOnPath('dsh', input.pathEnv, input.platform)) {
    return { command: 'dsh', argsPrefix: [], shell: input.platform === 'win32' }
  }
  return undefined
}
