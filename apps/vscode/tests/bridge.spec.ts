import { describe, expect, it } from 'vitest'
import { startBridge, type OpenDiffRequest, type OpenFileRequest } from '../src/bridge'

describe('startBridge', () => {
  it('opens a file through the token-protected endpoint', async () => {
    const seen: OpenFileRequest[] = []
    const bridge = await startBridge({
      openFile: async (request) => {
        seen.push(request)
        return true
      },
      openDiff: async () => false,
    })
    try {
      const response = await fetch(`${bridge.url}/open-file`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ path: 'C:/x/y.ts', line: 7 }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ opened: true })
      expect(seen).toEqual([{ path: 'C:/x/y.ts', line: 7 }])
    } finally {
      await bridge.stop()
    }
  })

  it('opens a diff through the token-protected endpoint', async () => {
    const seen: OpenDiffRequest[] = []
    const bridge = await startBridge({
      openFile: async () => false,
      openDiff: async (request) => {
        seen.push(request)
        return true
      },
    })
    try {
      const response = await fetch(`${bridge.url}/open-diff`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ path: 'a.ts', oldText: 'old', newText: 'new' }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ opened: true })
      expect(seen).toEqual([{ path: 'a.ts', oldText: 'old', newText: 'new' }])
    } finally {
      await bridge.stop()
    }
  })

  it('rejects unauthenticated and invalid requests', async () => {
    const bridge = await startBridge({
      openFile: async () => true,
      openDiff: async () => true,
    })
    try {
      const unauthorized = await fetch(`${bridge.url}/open-file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'a.ts' }),
      })
      expect(unauthorized.status).toBe(401)

      const invalid = await fetch(`${bridge.url}/open-file`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ path: '' }),
      })
      expect(invalid.status).toBe(400)
    } finally {
      await bridge.stop()
    }
  })
})
