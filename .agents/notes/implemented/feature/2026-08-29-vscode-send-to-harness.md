# Agent Note: VS Code context-menu send-to-harness

Status: implemented

English | [中文](2026-08-29-vscode-send-to-harness.zh.md)

## Problem

Users working in VS Code with the embedded DeepSeek Harness sidebar must manually copy a file path or selection reference into the composer. There is no editor-integrated gesture to send a file path or a line-range reference to the harness input caret.

## Decision

The extension contributes two commands and two context-menu entries:

- `dsh.sendSelection` appears in `editor/context` when a file selection exists; it formats the active file's absolute path and 0-based selection as a 1-based reference (`path:line` for one line, `path:start-end` for a range) and sends it to the composer caret.
- `dsh.sendFile` appears in `editor/title/context` for file tabs; it sends the tab's absolute path.

Delivery is a three-hop message path: the extension posts a typed message to its webview frame; the frame script forwards it to the harness iframe with the launch token read from the iframe URL, queueing until the iframe load event; the web client's `ui-conversation` plugin owns a `message` listener that verifies embed mode, token equality, and a current session, then calls the session's existing `SessionInputShell.paste()` to insert at the composer caret. The web client echoes an `ok`/error result back through the frame to the extension, which resolves the send command (with a five-second timeout). The frame also posts a `ready` message so the extension does not post before the bridge script is live.

The selection formatting and message validation are pure functions (`apps/vscode/src/format.ts`, `packages/client/ui-conversation/src/client/embed-input.ts`) so the line-range and token rules are unit-testable.

## Alternatives considered

**Directly manipulate the iframe DOM from the extension host.** Rejected: the webview frame and the harness iframe are cross-origin; the extension host cannot reach into iframe DOM, and reaching around the webview API would bypass VS Code's message boundary.

**Drive the composer through a Host RPC/session API.** Rejected: no public transport exists for mutating an unsent client-side composer draft; the draft lives in the browser's Lexical editor, not in Host session state. The postMessage path keeps the edit local to the UI exactly like a paste.

**Fire-and-forget send without acknowledgement.** Rejected: the extension could not tell the user when no session was selected or the sidebar was not ready. The ack/timeout keeps the command honest.

**Send the raw selected text instead of a path/line reference.** Rejected: the requested format is a stable editor reference, and pasting potentially large file contents into a prompt is a different feature.

## Consequences

A harness session must be selected and the embedded page must carry the launch token for sends to succeed; the extension opens/waits for the sidebar automatically. Otherwise the user sees a generic warning. The webview frame now allows an inline script (`script-src 'unsafe-inline'`), which is confined to the trusted extension-generated frame. The internal message protocol is unversioned and shared only by these two ends; a future rewrite should keep token validation on the receiving side.
