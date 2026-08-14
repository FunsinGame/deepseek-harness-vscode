/**
 * The DeepSeek Harness VS Code extension. It lazily boots the harness `web`
 * profile as a child process bound to the open workspace, then embeds the full
 * DeepSeek Harness GUI in the activity-bar view. Because the harness boots with
 * the workspace as its working directory, the GUI's session list shows exactly
 * that workspace's conversations, and clicking a session opens its chat.
 */

import { resolve } from 'node:path'
import * as vscode from 'vscode'
import { buildProfileArgs, resolveLaunch, type WebFlags } from './cli'
import { startServer, type RunningServer } from './server'

const OUTPUT_NAME = 'DeepSeek Harness'
const VIEW_ID = 'dsh.web'

/** Module-scope so `deactivate` can stop the harness on extension shutdown. */
let server: RunningServer | undefined
let booting: Promise<RunningServer | undefined> | undefined
let webProvider: WebViewProvider | undefined

class WebViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined

  constructor(private readonly boot: () => Promise<RunningServer | undefined>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = this.shell('<p class="hint">正在启动 DeepSeek Harness…</p>')
    void this.connect()
  }

  async connect(): Promise<void> {
    const running = await this.boot()
    const webview = this.view?.webview
    if (webview === undefined) return
    webview.html = running === undefined
      ? this.shell('<p class="hint error">DeepSeek Harness 启动失败。</p>')
      : this.frame(`${running.url}?embed=1`)
  }

  offline(): void {
    const webview = this.view?.webview
    if (webview === undefined) return
    webview.html = this.shell('<p class="hint">DeepSeek Harness 已停止——运行「DeepSeek Harness: Open」重新启动。</p>')
  }

  private frame(url: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:*;">
<style>
html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
iframe { width: 100%; height: 100%; border: 0; display: block; }
</style>
</head>
<body>
<iframe id="dsh" src="${url}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals" allow="clipboard-read; clipboard-write"></iframe>
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

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_NAME)
  context.subscriptions.push(output)

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
    const promise = startServer({
      launch,
      flags: buildProfileArgs(flags),
      ...(cwd === undefined ? {} : { cwd }),
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

  webProvider = new WebViewProvider(boot)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, webProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('dsh.open', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
    vscode.commands.registerCommand('dsh.openBrowser', () => openBrowser()),
    vscode.commands.registerCommand('dsh.restart', () => restart()),
    vscode.commands.registerCommand('dsh.stop', () => stop()),
  )

  setStatus(false)
}

export async function deactivate(): Promise<void> {
  const running = server
  server = undefined
  if (running === undefined) return
  await running.stop()
}
