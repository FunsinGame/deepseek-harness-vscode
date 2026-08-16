/**
 * Loopback HTTP bridge that lets the harness child process ask the VS Code
 * extension host to open files and diffs in the current window. Node-only (no
 * `vscode` import); the extension supplies the editor callbacks, and harness
 * plugins receive the base URL and bearer token through `DSH_VSCODE_BRIDGE` /
 * `DSH_VSCODE_BRIDGE_TOKEN`.
 */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/** A request to open one file at an optional 1-based line. */
export interface OpenFileRequest {
  path: string
  line?: number
}

/** A request to open a two-way diff of text snapshots. */
export interface OpenDiffRequest {
  path: string
  oldText: string
  newText: string
}

/** Editor operations the extension host implements for the bridge. */
export interface BridgeHandlers {
  openFile(request: OpenFileRequest): Promise<boolean>
  openDiff(request: OpenDiffRequest): Promise<boolean>
}

/** A running bridge server with its token-protected base URL. */
export interface RunningBridge {
  /** Base URL for harness plugins, e.g. `http://127.0.0.1:1234`. */
  url: string
  port: number
  /** Bearer token a caller must send to use the bridge. */
  token: string
  stop(): Promise<void>
}

const MAX_BODY_BYTES = 1024 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOpenFileRequest(value: unknown): OpenFileRequest | undefined {
  if (!isRecord(value)) return undefined
  const path = value.path
  if (typeof path !== 'string' || path.length === 0) return undefined
  const line = value.line
  if (line === undefined) return { path }
  if (typeof line !== 'number' || !Number.isInteger(line) || line <= 0) return undefined
  return { path, line }
}

function readOpenDiffRequest(value: unknown): OpenDiffRequest | undefined {
  if (!isRecord(value)) return undefined
  const path = value.path
  const oldText = value.oldText
  const newText = value.newText
  if (typeof path !== 'string' || path.length === 0) return undefined
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  return { path, oldText, newText }
}

/**
 * Start the loopback bridge on an OS-assigned port.
 * @param handlers - the extension host's file/diff open implementations.
 * @returns the running bridge handle.
 */
export function startBridge(handlers: BridgeHandlers): Promise<RunningBridge> {
  const token = randomBytes(16).toString('hex')
  const server = createServer((req, res) => {
    void handleRequest(req, res, token, handlers)
  })

  return new Promise<RunningBridge>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('bridge: listener did not return a TCP address'))
        return
      }
      const port = address.port
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        port,
        token,
        stop: () => new Promise<void>((resolveStop, rejectStop) => {
          server.closeAllConnections()
          server.close((error) => {
            if (error !== undefined) rejectStop(error)
            else resolveStop()
          })
        }),
      })
    })
  })
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  handlers: BridgeHandlers,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const authorization = req.headers.authorization
  if (authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }
  const path = req.url?.split('?', 1)[0] ?? ''
  try {
    const body = await readJsonBody(req)
    if (path === '/open-file') {
      const request = readOpenFileRequest(body)
      if (request === undefined) {
        sendJson(res, 400, { error: 'invalid open-file request' })
        return
      }
      const opened = await handlers.openFile(request)
      sendJson(res, 200, { opened })
      return
    }
    if (path === '/open-diff') {
      const request = readOpenDiffRequest(body)
      if (request === undefined) {
        sendJson(res, 400, { error: 'invalid open-diff request' })
        return
      }
      const opened = await handlers.openDiff(request)
      sendJson(res, 200, { opened })
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'internal error' })
  }
}
