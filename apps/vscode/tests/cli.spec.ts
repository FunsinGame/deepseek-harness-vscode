import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildProfileArgs, parseReadyLine, resolveLaunch } from '../src/cli'

const temp = mkdtempSync(join(tmpdir(), 'dsh-vscode-'))
afterAll(() => { rmSync(temp, { recursive: true, force: true }) })

describe('buildProfileArgs', () => {
  it('assembles the web-profile flag vector', () => {
    expect(buildProfileArgs({ host: '127.0.0.1', port: 0 })).toEqual([
      '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open',
    ])
  })
})

describe('parseReadyLine', () => {
  it('parses the printed readiness line including the launch token', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:3080/?token=test-token'))
      .toEqual({ host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080/?token=test-token' })
  })

  it('parses a tokenless readiness line for backward compatibility', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:3080'))
      .toEqual({ host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080' })
  })

  it('takes only the loopback URL when a LAN URL follows', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:3080/?token=test-token (LAN: http://192.168.1.5:3080/?token=other)'))
      .toEqual({ host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080/?token=test-token' })
  })

  it('ignores unrelated and malformed lines', () => {
    expect(parseReadyLine('some other log')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://127.0.0.1:')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://127.0.0.1:abc')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://127.0.0.1:70000/?token=x')).toBeUndefined()
  })
})

describe('resolveLaunch', () => {
  const base = {
    cliPath: '',
    envCli: undefined,
    platform: 'linux' as NodeJS.Platform,
    pathEnv: undefined,
    devFallback: undefined,
  }

  it('prefers an explicit entry and runs it through node', () => {
    const entry = join(temp, 'bin.js')
    writeFileSync(entry, '')
    expect(resolveLaunch({ ...base, cliPath: entry })).toEqual({
      command: 'node', argsPrefix: [entry], shell: false,
    })
  })

  it('falls back to DSH_CLI', () => {
    const entry = join(temp, 'env-bin.js')
    expect(resolveLaunch({ ...base, envCli: entry })).toEqual({
      command: 'node', argsPrefix: [entry], shell: false,
    })
  })

  it('uses an existing source-checkout build', () => {
    const entry = join(temp, 'cli.js')
    writeFileSync(entry, '')
    expect(resolveLaunch({ ...base, devFallback: entry })).toEqual({
      command: 'node', argsPrefix: [entry], shell: false,
    })
  })

  it('ignores a dev fallback that does not exist', () => {
    expect(resolveLaunch({ ...base, devFallback: join(temp, 'missing.js') })).toBeUndefined()
  })

  it('resolves `dsh` on PATH', () => {
    writeFileSync(join(temp, 'dsh'), '')
    writeFileSync(join(temp, 'dsh.cmd'), '')
    const resolved = resolveLaunch({ ...base, pathEnv: temp })
    expect(resolved?.command).toBe('dsh')
    expect(resolved?.shell).toBe(false)
  })

  it('returns undefined when nothing resolves', () => {
    expect(resolveLaunch(base)).toBeUndefined()
  })
})

describe('resolveLaunch on win32', () => {
  it('runs a PATH-resolved `dsh` through a shell', () => {
    const dir = join(temp, 'win')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'dsh.cmd'), '')
    const resolved = resolveLaunch({
      cliPath: '',
      envCli: undefined,
      platform: 'win32',
      pathEnv: dir,
      devFallback: undefined,
    })
    expect(resolved).toEqual({ command: 'dsh', argsPrefix: [], shell: true })
    expect(existsSync(dir)).toBe(true)
  })
})
