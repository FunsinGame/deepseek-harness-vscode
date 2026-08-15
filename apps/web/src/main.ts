/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * loader holding, module-table seeding, AppRoot gate, plugin assembly — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

// Embedded (VS Code sidebar) mode: the extension loads this app in an iframe
// with ?embed=1. Flag the document root before the shell runs so embed-aware
// UI (workspace-management chrome hidden, flat session list) can read it.
if (new URLSearchParams(window.location.search).get('embed') === '1') {
  document.documentElement.dataset.dshEmbed = '1'
  const cwd = new URLSearchParams(window.location.search).get('cwd')
  if (cwd !== null) document.documentElement.dataset.dshCwd = cwd
}

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
