import { describe, expect, it } from 'vitest'
import { startServer } from '../src/server'

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

  it('rejects when the child exits before printing readiness', async () => {
    await expect(startServer({
      launch: { command: process.execPath, argsPrefix: ['-e', 'process.exit(3)'], shell: false },
      flags: [],
      timeoutMs: 5_000,
    })).rejects.toThrow(/readiness/)
  })
})
