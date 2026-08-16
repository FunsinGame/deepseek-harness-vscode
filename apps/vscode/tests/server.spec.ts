import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { startServer } from '../src/server'

const temp = mkdtempSync(join(tmpdir(), 'dsh-vscode-server-'))
afterAll(() => { rmSync(temp, { recursive: true, force: true }) })

describe('startServer', () => {
  it('parses the readiness line and stops the child', async () => {
    const script = "console.log('dsh web: http://127.0.0.1:43210'); setInterval(() => {}, 1000)"
    const server = await startServer({
      launch: { command: process.execPath, argsPrefix: ['-e', script], shell: false },
      flags: [],
      timeoutMs: 5_000,
    })
    expect(server.url).toBe('http://127.0.0.1:43210')
    expect(server.port).toBe(43210)

    await server.stop()
    const code = await server.exitCode
    expect(code === null || typeof code === 'number').toBe(true)
  })

  it('forwards extra env vars to the child', async () => {
    const outFile = join(temp, 'env.txt')
    const script = [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(outFile)}, process.env.DSH_TEST_BRIDGE ?? 'missing');`,
      "console.log('dsh web: http://127.0.0.1:43211');",
      'setInterval(() => {}, 1000)',
    ].join('')
    const server = await startServer({
      launch: { command: process.execPath, argsPrefix: ['-e', script], shell: false },
      flags: [],
      env: { DSH_TEST_BRIDGE: 'http://127.0.0.1:1234' },
      timeoutMs: 5_000,
    })
    expect(existsSync(outFile)).toBe(true)
    expect(readFileSync(outFile, 'utf8')).toBe('http://127.0.0.1:1234')

    await server.stop()
    const code = await server.exitCode
    expect(code === null || typeof code === 'number').toBe(true)
  })

  it('rejects when the child exits before printing readiness', async () => {
    await expect(startServer({
      launch: { command: process.execPath, argsPrefix: ['-e', 'process.exit(3)'], shell: false },
      flags: [],
      timeoutMs: 5_000,
    })).rejects.toThrow(/readiness/)
  })
})
