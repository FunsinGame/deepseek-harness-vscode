/**
 * VS Code embed input: receives `insert-text` messages from the sidebar
 * extension's webview frame and inserts the payload at the composer caret.
 * The parent frame forwards the extension message after checking the launch
 * token embedded in the iframe URL, and this page echoes the outcome back so
 * the extension can surface a failure.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Message sent from the VS Code extension through the webview frame. */
export interface EmbedInsertMessage {
  readonly source: 'dsh-vscode'
  readonly type: 'insert-text'
  readonly id: string
  readonly token: string | undefined
  readonly text: string
}

/** Result echoed back to the VS Code extension through the webview frame. */
export interface EmbedInsertResult {
  readonly source: 'dsh-web'
  readonly type: 'insert-text-result'
  readonly id: string
  readonly ok: boolean
  readonly error?: string
}

/** Dependencies the embed-input handler needs from the Conversation plugin. */
export interface EmbedInputDeps {
  /** Whether the document is loaded in the VS Code sidebar iframe. */
  isEmbed(): boolean
  /** Launch token from the current page URL, if present. */
  pageToken(): string | undefined
  /** Currently selected session, if any. */
  currentSessionId(): SessionId | undefined
  /** Insert plain text at the composer caret of one session. */
  insertText(sessionId: SessionId, text: string): void
  /** Deliver an insert outcome back to the parent webview frame. */
  sendResult(result: EmbedInsertResult): void
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Handle one inbound embed-insert message. Returns a result to echo, or
 * undefined when the message is not one this feature owns.
 * @param value - raw `message.data` from the parent frame.
 * @param deps - embed-mode, token, session, and insert dependencies.
 * @returns the echo result, or undefined for non-feature messages.
 */
export function handleEmbedInsertMessage(value: unknown, deps: EmbedInputDeps): EmbedInsertResult | undefined {
  if (!deps.isEmbed()) return undefined
  if (!isRecord(value) || value.source !== 'dsh-vscode' || value.type !== 'insert-text') return undefined
  const id = value.id
  const text = value.text
  if (typeof id !== 'string' || id === '' || typeof text !== 'string') return undefined
  const token = deps.pageToken()
  if (token === undefined || value.token !== token) {
    return { source: 'dsh-web', type: 'insert-text-result', id, ok: false, error: 'unauthorized' }
  }
  const sessionId = deps.currentSessionId()
  if (sessionId === undefined) {
    return { source: 'dsh-web', type: 'insert-text-result', id, ok: false, error: 'no active session' }
  }
  try {
    deps.insertText(sessionId, text)
    return { source: 'dsh-web', type: 'insert-text-result', id, ok: true }
  } catch (error) {
    return {
      source: 'dsh-web',
      type: 'insert-text-result',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Install the window-message listener that feeds the VS Code sidebar.
 * @param deps - embed-input dependencies.
 * @returns a disposer that removes the listener.
 */
export function installEmbedInput(deps: EmbedInputDeps): () => void {
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return
    const result = handleEmbedInsertMessage(event.data, deps)
    if (result !== undefined) deps.sendResult(result)
  }
  window.addEventListener('message', listener)
  return () => { window.removeEventListener('message', listener) }
}
