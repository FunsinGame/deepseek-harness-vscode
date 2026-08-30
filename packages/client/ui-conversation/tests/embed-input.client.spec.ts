// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  handleEmbedInsertMessage,
  installEmbedInput,
  type EmbedInputDeps,
  type EmbedInsertResult,
} from '../src/client/embed-input.ts'

const SID = 'session-1' as SessionId

type DepsWithMocks = EmbedInputDeps & {
  insertText: ReturnType<typeof vi.fn>
  sendResult: ReturnType<typeof vi.fn>
}

function deps(overrides: Partial<EmbedInputDeps> = {}): DepsWithMocks {
  const insertText = (overrides.insertText ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
  const sendResult = (overrides.sendResult ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
  return {
    isEmbed: overrides.isEmbed ?? (() => true),
    pageToken: overrides.pageToken ?? (() => 'token'),
    currentSessionId: overrides.currentSessionId ?? (() => SID),
    insertText,
    sendResult,
  } as unknown as DepsWithMocks
}

describe('handleEmbedInsertMessage', () => {
  it('ignores messages outside the VS Code embed iframe', () => {
    const d = deps({ isEmbed: () => false })
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', text: 'x' }, d)).toBeUndefined()
  })

  it('ignores messages this feature does not own', () => {
    const d = deps()
    expect(handleEmbedInsertMessage({ source: 'other', type: 'insert-text', id: '1', text: 'x' }, d)).toBeUndefined()
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'ping', id: '1', text: 'x' }, d)).toBeUndefined()
  })

  it('rejects messages without a valid id or text', () => {
    const d = deps()
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '', text: 'x' }, d)).toBeUndefined()
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', text: 7 }, d)).toBeUndefined()
  })

  it('rejects a mismatched launch token', () => {
    const d = deps()
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'wrong', text: 'x' }, d))
      .toEqual<EmbedInsertResult>({
        source: 'dsh-web',
        type: 'insert-text-result',
        id: '1',
        ok: false,
        error: 'unauthorized',
      })
    expect(d.insertText).not.toHaveBeenCalled()
  })

  it('reports when no session is current', () => {
    const d = deps({ currentSessionId: () => undefined })
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'token', text: 'x' }, d))
      .toEqual<EmbedInsertResult>({
        source: 'dsh-web',
        type: 'insert-text-result',
        id: '1',
        ok: false,
        error: 'no active session',
      })
  })

  it('inserts at the active composer caret and echoes success', () => {
    const d = deps()
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'token', text: 'C:\\a.ts:3' }, d))
      .toEqual<EmbedInsertResult>({ source: 'dsh-web', type: 'insert-text-result', id: '1', ok: true })
    expect(d.insertText).toHaveBeenCalledWith(SID, 'C:\\a.ts:3')
    expect(d.sendResult).not.toHaveBeenCalled()
  })

  it('echoes insert failures', () => {
    const d = deps({ insertText: () => { throw new Error('boom') } })
    expect(handleEmbedInsertMessage({ source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'token', text: 'x' }, d))
      .toEqual<EmbedInsertResult>({
        source: 'dsh-web',
        type: 'insert-text-result',
        id: '1',
        ok: false,
        error: 'boom',
      })
  })
})

describe('installEmbedInput', () => {
  it('listens for parent-frame messages and disposes cleanly', () => {
    const d = deps()
    const off = installEmbedInput(d)
    const message = { source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'token', text: 'x' }
    window.dispatchEvent(new MessageEvent('message', { data: message, source: window }))
    expect(d.insertText).toHaveBeenCalledWith(SID, 'x')
    expect(d.sendResult).toHaveBeenCalledWith({
      source: 'dsh-web',
      type: 'insert-text-result',
      id: '1',
      ok: true,
    } satisfies EmbedInsertResult)

    off()
    window.dispatchEvent(new MessageEvent('message', { data: message, source: window }))
    expect(d.insertText).toHaveBeenCalledTimes(1)
  })

  it('ignores messages not sent by the parent frame', () => {
    const d = deps()
    installEmbedInput(d)
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'dsh-vscode', type: 'insert-text', id: '1', token: 'token', text: 'x' }, source: null }))
    expect(d.insertText).not.toHaveBeenCalled()
  })
})
