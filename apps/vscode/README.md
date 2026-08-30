# dsh-vscode

The DeepSeek Harness VS Code extension: it boots the harness `web` profile on a loopback port, bound to the open workspace, and embeds the full DeepSeek Harness GUI in the activity-bar view. Because the harness boots with the workspace as its working directory, the GUI's session list shows the current workspace's conversations; clicking a session opens its chat. The interface is the DeepSeek Harness web GUI itself, so it is identical to `dsh --profile web` — every feature and interaction included.

## How it works

1. On activation the extension registers a status bar item, an activity-bar **DeepSeek Harness** view, and commands (`Open`, `Open in Browser`, `Restart`, `Stop`, `发送到 DSH` for editor selections and file tabs).
2. Opening the view resolves the `dsh` CLI in this order: the `dsh.cliPath` setting, the `DSH_CLI` environment variable, the `apps/cli/lib/bin.js` build inside a source checkout, then `dsh` on `PATH`.
3. It spawns `dsh --profile web --host 127.0.0.1 --port <dsh.port> --no-open` (port `0` requests an OS-assigned port, and `--no-open` keeps the default browser closed) with the first workspace folder as its working directory, then waits for the `dsh web: http://127.0.0.1:<port>/?token=...` readiness line.
4. The view renders that URL in a full-size iframe. `Open in Browser` hands the same URL to `vscode.env.openExternal`. In embedded mode (`DSH_VSCODE=1`) the harness keeps the launch token in the iframe URL and accepts it on `/api` calls and the WebSocket mux, so the sidebar does not depend on cross-origin cookies.
5. The extension also starts a token-protected loopback bridge and passes `DSH_VSCODE=1`, `DSH_VSCODE_BRIDGE`, and `DSH_VSCODE_BRIDGE_TOKEN` to the child. Harness plugins that detect the embedded mode can call `POST /open-file` and `POST /open-diff` on that bridge to open files/diffs in the current VS Code window instead of spawning a separate `code` process.

## Send to DeepSeek Harness

- Right-click a text selection in a file editor and choose **发送到 DSH** to insert a reference at the composer caret. A single-line selection sends `path:line`; a multi-line selection sends `path:start-end` (1-based, inclusive), for example `c:\g-workspace\Heyang-Projects\All-Wiki\余烬狩猎.md:53-63`.
- Right-click a file tab and choose **发送到 DSH** to insert the file's absolute path at the composer caret.
- A harness session must be selected; the extension opens/waits for the sidebar automatically when a send command runs.

## Requirements

- Node.js `^22.19 || >=24` (the harness engine requirement) with `dsh` available, or a checkout of this repository built with `pnpm run build`.
- A configured model provider. The GUI boots without one and shows onboarding; agents need `DEEPSEEK_API_KEY` or the equivalent configured in the harness.

## Development

```sh
pnpm install
pnpm --filter dsh-vscode run build   # tsc -> dist/extension.js
```

To run the extension in an Extension Development Host, open the `apps/vscode` folder and add an `.vscode/launch.json` with an `extensionHost` configuration whose `args` is `["--extensionDevelopmentPath=${workspaceFolder}"]` and whose `preLaunchTask` runs the `build` script. Alternatively package and install it (see below).

## Packaging

From `apps/vscode`:

```sh
npx --yes @vscode/vsce package --no-dependencies
```

The command runs the `vscode:prepublish` build (`tsc`) and produces `dsh-vscode-<version>.vsix`; install it with the VS Code `Extensions: Install from VSIX...` command. The packaged extension does not bundle the `dsh` CLI, so the target machine needs `dsh` on `PATH`, or you must set `dsh.cliPath` to a built `apps/cli/lib/bin.js` (or an installed `@deepseek-ai/dsh` `lib/bin.js`).

## Troubleshooting

If the sidebar view shows the full browser layout instead of the embedded single-column layout, the extension is likely using a `dsh` CLI whose web frontend predates the `?embed=1` support. Fix:

1. Use the activity-bar **DeepSeek Harness** view (or `DeepSeek Harness: Open`), not `DeepSeek Harness: Open in Browser`.
2. Set `dsh.cliPath` to this checkout's built CLI, e.g.:
   ```json
   "dsh.cliPath": "C:\\g-workspace\\deepseek-harness-vscode\\apps\\cli\\lib\\bin.js"
   ```
3. Make sure the current web frontend is built (`pnpm run build:web` from the repository root).
4. Run `DeepSeek Harness: Restart` or reload the VS Code window.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `dsh.cliPath` | `""` | Absolute path to the `dsh` CLI entry (`lib/bin.js`). Empty resolves `dsh` from `PATH`. |
| `dsh.host` | `127.0.0.1` | Loopback bind host (only loopback is offered). |
| `dsh.port` | `0` | Listen port; `0` requests an OS-assigned port. |
