/**
 * The DeepSeek Harness VS Code extension. It lazily boots the harness `web`
 * profile as a child process bound to the open workspace, then embeds the full
 * DeepSeek Harness GUI in the activity-bar view. Because the harness boots with
 * the workspace as its working directory, the GUI's session list shows exactly
 * that workspace's conversations, and clicking a session opens its chat.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import * as vscode from 'vscode'
import { startBridge, type BridgeHandlers, type RunningBridge } from './bridge'
import { buildProfileArgs, resolveLaunch, type WebFlags } from './cli'
import { formatSelectionReference } from './format'
import { startServer, type RunningServer } from './server'

const OUTPUT_NAME = 'DeepSeek Harness'
const VIEW_ID = 'dsh.web'

/** Module-scope so `deactivate` can stop the harness on extension shutdown. */
let server: RunningServer | undefined
let booting: Promise<RunningServer | undefined> | undefined
let webProvider: WebViewProvider | undefined
let bridge: RunningBridge | undefined
let bridgePromise: Promise<RunningBridge | undefined> | undefined

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface PendingInsert {
  resolve(ok: boolean): void
  timer: ReturnType<typeof setTimeout>
}

class WebViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private connected = false
  private messageListener: vscode.Disposable | undefined
  private readonly pending = new Map<string, PendingInsert>()
  private ready: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | undefined
  private seq = 0

  constructor(private readonly boot: () => Promise<RunningServer | undefined>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.connected = false
    this.resetReady()
    view.webview.options = { enableScripts: true }
    this.messageListener?.dispose()
    this.messageListener = view.webview.onDidReceiveMessage((message) => {
      if (!isRecord(message)) return
      if (message.type === 'dsh.ready') {
        this.resolveReady?.()
        return
      }
      if (message.type !== 'dsh.insert-text-result' || typeof message.id !== 'string') return
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      pending.resolve(message.ok === true)
    })
    view.webview.html = this.shell('<p class="hint">正在启动 DeepSeek Harness…</p>')
    void this.connect()
  }

  async connect(): Promise<void> {
    const running = await this.boot()
    const webview = this.view?.webview
    if (webview === undefined) return
    if (running === undefined) {
      this.connected = false
      webview.html = this.shell('<p class="hint error">DeepSeek Harness 启动失败。</p>')
      return
    }
    // Keep the launch token from the printed URL and scope the embedded session
    // list to the open workspace: its path rides the URL so the web filters
    // `session.list` rows by `cwd`.
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    const url = new URL(running.url)
    url.searchParams.set('embed', '1')
    url.searchParams.set('cwd', cwd)
    this.resetReady()
    webview.html = this.frame(url.toString())
    this.connected = true
  }

  offline(): void {
    const webview = this.view?.webview
    if (webview === undefined) return
    this.connected = false
    this.resetReady()
    webview.html = this.shell('<p class="hint">DeepSeek Harness 已停止——运行「DeepSeek Harness: Open」重新启动。</p>')
  }

  /**
   * Send text into the embedded harness input. Focuses the sidebar view and
   * waits for the harness iframe before posting; resolves false when the
   * frame does not acknowledge within five seconds.
   * @param text - text to insert at the composer caret.
   * @returns whether the harness accepted the insert.
   */
  async sendToHarness(text: string): Promise<boolean> {
    if (this.view === undefined) {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      if (this.view === undefined) return false
    }
    if (!this.connected) {
      const running = await this.boot()
      if (running === undefined || this.view === undefined) return false
      await this.connect()
      if (!this.connected) return false
    }
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      void this.ready.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    if (!ready) return false
    const webview = this.view.webview
    const id = `dsh-${String(++this.seq)}`
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(false)
      }, 5000)
      this.pending.set(id, { resolve, timer })
      const message = { type: 'dsh.insert-text', id, text }
      try {
        const posted = webview.postMessage(message)
        if (posted !== undefined) {
          void Promise.resolve(posted).then((accepted) => {
            if (accepted !== false) return
            const entry = this.pending.get(id)
            if (entry === undefined) return
            clearTimeout(entry.timer)
            this.pending.delete(id)
            entry.resolve(false)
          }).catch(() => {
            const entry = this.pending.get(id)
            if (entry === undefined) return
            clearTimeout(entry.timer)
            this.pending.delete(id)
            entry.resolve(false)
          })
        }
      } catch {
        const entry = this.pending.get(id)
        if (entry !== undefined) {
          clearTimeout(entry.timer)
          this.pending.delete(id)
          entry.resolve(false)
        }
      }
    })
  }

  dispose(): void {
    this.messageListener?.dispose()
    this.messageListener = undefined
    for (const { timer, resolve } of this.pending.values()) {
      clearTimeout(timer)
      resolve(false)
    }
    this.pending.clear()
  }

  private resetReady(): void {
    this.resolveReady = undefined
    this.ready = new Promise<void>((resolve) => { this.resolveReady = resolve })
  }

  private frame(url: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:*;">
<style>
html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
iframe { width: 100%; height: 100%; border: 0; display: block; }
</style>
</head>
<body>
<iframe id="dsh" src="${url}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals" allow="clipboard-read; clipboard-write"></iframe>
<script>
(function () {
  const vscode = acquireVsCodeApi()
  vscode.postMessage({ type: 'dsh.ready' })
  const iframe = document.getElementById('dsh')
  const origin = new URL(iframe.getAttribute('src')).origin
  const token = new URL(iframe.getAttribute('src')).searchParams.get('token') || ''
  let loaded = false
  const pending = []
  iframe.addEventListener('load', () => {
    loaded = true
    for (const message of pending) iframe.contentWindow.postMessage(message, origin)
    pending.length = 0
  })
  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.type !== 'dsh.insert-text' || typeof data.id !== 'string' || typeof data.text !== 'string') return
    const message = { source: 'dsh-vscode', type: 'insert-text', id: data.id, text: data.text, token }
    if (loaded) iframe.contentWindow.postMessage(message, origin)
    else pending.push(message)
  })
  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return
    const data = event.data
    if (!data || data.source !== 'dsh-web' || data.type !== 'insert-text-result') return
    vscode.postMessage({ type: 'dsh.insert-text-result', id: data.id, ok: data.ok === true })
  })
})()
</script>
</body>
</html>`
  }

  private shell(body: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:*;">
<style>
html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
.hint { padding: 12px; margin: 0; color: var(--vscode-descriptionForeground); }
.hint.error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>${body}</body>
</html>`
  }
}

function resolveFileUri(targetPath: string): vscode.Uri {
  if (isAbsolute(targetPath)) {
    return vscode.Uri.file(targetPath)
  }
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    for (const folder of folders) {
      const candidateFsPath = resolve(folder.uri.fsPath, targetPath)
      if (existsSync(candidateFsPath)) {
        return vscode.Uri.file(candidateFsPath)
      }
    }
    const firstFolder = folders[0]
    if (firstFolder !== undefined) {
      return vscode.Uri.file(resolve(firstFolder.uri.fsPath, targetPath))
    }
  }
  return vscode.Uri.file(targetPath)
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME)
  context.subscriptions.push(output)

  function getBridge(): Promise<RunningBridge | undefined> {
    if (bridge !== undefined) return Promise.resolve(bridge)
    if (bridgePromise !== undefined) return bridgePromise

    const handlers: BridgeHandlers = {
      openFile: async ({ path, line }) => {
        try {
          const fileUri = resolveFileUri(path)
          const document = await vscode.workspace.openTextDocument(fileUri)
          await vscode.window.showTextDocument(document, {
            preview: true,
            ...(line === undefined ? {} : { selection: new vscode.Range(line - 1, 0, line - 1, 0) }),
          })
          return true
        } catch (error) {
          output.appendLine(`[dsh-vscode] openFile failed: ${errorMessage(error)}`)
          return false
        }
      },
      openDiff: async ({ path, oldText, newText }) => {
        try {
          const dir = await mkdtemp(join(tmpdir(), 'dsh-vscode-diff-'))
          const ext = extname(path)
          const base = basename(path, ext)
          const oldPath = join(dir, `${base}.old${ext}`)
          const newPath = join(dir, `${base}.new${ext}`)
          await writeFile(oldPath, oldText, 'utf8')
          await writeFile(newPath, newText, 'utf8')
          await vscode.commands.executeCommand(
            'vscode.diff',
            vscode.Uri.file(oldPath),
            vscode.Uri.file(newPath),
            `${base}${ext} (DSH diff)`,
          )
          return true
        } catch (error) {
          output.appendLine(`[dsh-vscode] openDiff failed: ${errorMessage(error)}`)
          return false
        }
      },
    }

    bridgePromise = startBridge(handlers)
      .then((running) => {
        bridge = running
        bridgePromise = undefined
        return running
      })
      .catch((error: unknown) => {
        bridgePromise = undefined
        output.appendLine(`[dsh-vscode] bridge failed to start: ${errorMessage(error)}`)
        return undefined
      })
    return bridgePromise
  }

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = 'dsh.open'
  context.subscriptions.push(statusBar)

  const setStatus = (running: boolean, url?: string): void => {
    statusBar.text = running ? '$(rocket) DeepSeek Harness' : '$(debug-start) DeepSeek Harness'
    statusBar.tooltip = running
      ? `DeepSeek Harness running at ${url ?? ''} — click to open`
      : 'DeepSeek Harness stopped — click to start'
    statusBar.show()
  }

  function readFlags(): WebFlags {
    const config = vscode.workspace.getConfiguration('dsh')
    return { host: config.get<string>('host', '127.0.0.1'), port: config.get<number>('port', 0) }
  }

  async function boot(): Promise<RunningServer | undefined> {
    if (server !== undefined) return server
    if (booting !== undefined) return booting

    const flags = readFlags()
    const config = vscode.workspace.getConfiguration('dsh')
    const launch = resolveLaunch({
      cliPath: config.get<string>('cliPath', ''),
      envCli: process.env.DSH_CLI,
      platform: process.platform,
      pathEnv: process.env.PATH,
      devFallback: resolve(__dirname, '..', '..', 'cli', 'lib', 'bin.js'),
    })

    if (launch === undefined) {
      void vscode.window.showErrorMessage(
        'DeepSeek Harness: could not find the `dsh` CLI. '
        + 'Set the `dsh.cliPath` setting, or install @deepseek-ai/dsh so `dsh` is on PATH.',
      )
      return undefined
    }

    const argv = [...launch.argsPrefix, ...buildProfileArgs(flags)]
    output.appendLine(`$ ${[launch.command, ...argv].join(' ')}`)

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const runningBridge = await getBridge()
    const env = runningBridge === undefined ? undefined : {
      DSH_VSCODE: '1',
      DSH_VSCODE_BRIDGE: runningBridge.url,
      DSH_VSCODE_BRIDGE_TOKEN: runningBridge.token,
    }
    const promise = startServer({
      launch,
      flags: buildProfileArgs(flags),
      ...(cwd === undefined ? {} : { cwd }),
      ...(env === undefined ? {} : { env }),
      onLog: text => output.append(text),
    }).then((running) => {
      server = running
      setStatus(true, running.url)
      void running.exitCode.then((code) => {
        output.appendLine(`dsh exited (code ${String(code)})`)
        if (server === running) {
          server = undefined
          setStatus(false)
          webProvider?.offline()
        }
      })
      return running
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      output.appendLine(`dsh failed to start: ${message}`)
      void vscode.window.showErrorMessage(`DeepSeek Harness failed to start: ${message}`)
      setStatus(false)
      return undefined
    }).finally(() => {
      booting = undefined
    })
    booting = promise

    return promise
  }

  async function openBrowser(): Promise<void> {
    const running = await boot()
    if (running === undefined) return
    await vscode.env.openExternal(vscode.Uri.parse(running.url))
  }

  async function stop(): Promise<void> {
    const running = server
    server = undefined
    if (running === undefined) return
    output.appendLine('Stopping dsh')
    setStatus(false)
    await running.stop()
  }

  async function restart(): Promise<void> {
    await stop()
    await webProvider?.connect()
  }

  async function sendToHarness(text: string): Promise<void> {
    if (webProvider === undefined) return
    const ok = await webProvider.sendToHarness(text)
    if (!ok) {
      void vscode.window.showWarningMessage('DeepSeek Harness 尚未就绪，无法发送到输入框。')
    }
  }

  async function sendSelection(uri?: vscode.Uri): Promise<void> {
    const editor = uri === undefined
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(candidate => candidate.document.uri.toString() === uri.toString())
        ?? vscode.window.activeTextEditor
    if (editor === undefined || editor.document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('只能发送本地文件的选择。')
      return
    }
    const selection = editor.selection
    await sendToHarness(formatSelectionReference(editor.document.uri.fsPath, {
      startLine: selection.start.line,
      startCharacter: selection.start.character,
      endLine: selection.end.line,
      endCharacter: selection.end.character,
    }))
  }

  async function sendFile(uri?: vscode.Uri): Promise<void> {
    const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri
    if (fileUri === undefined || fileUri.scheme !== 'file') {
      void vscode.window.showWarningMessage('没有可发送的本地文件。')
      return
    }
    await sendToHarness(fileUri.fsPath)
  }

  webProvider = new WebViewProvider(boot)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, webProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('dsh.open', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
    vscode.commands.registerCommand('dsh.openBrowser', () => openBrowser()),
    vscode.commands.registerCommand('dsh.restart', () => restart()),
    vscode.commands.registerCommand('dsh.stop', () => stop()),
    vscode.commands.registerCommand('dsh.sendSelection', (uri?: vscode.Uri) => sendSelection(uri)),
    vscode.commands.registerCommand('dsh.sendFile', (uri?: vscode.Uri) => sendFile(uri)),
  )

  setStatus(false)
}

export async function deactivate(): Promise<void> {
  webProvider?.dispose()
  webProvider = undefined
  const running = server
  server = undefined
  if (running !== undefined) {
    await running.stop()
  }
  const runningBridge = bridge
  bridge = undefined
  bridgePromise = undefined
  if (runningBridge !== undefined) {
    await runningBridge.stop()
  }
}
