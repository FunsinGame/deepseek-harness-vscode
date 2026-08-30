/**
 * Format helpers for the VS Code extension's "send to DeepSeek Harness"
 * commands.
 */

/** A 0-based VS Code selection line span. */
export interface SelectionLines {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

/**
 * Format an absolute file path plus a 0-based selection as a 1-based editor
 * reference. A single-line selection becomes `path:line`; a multi-line
 * selection becomes `path:start-end`, where `end` is the last included line
 * (a selection that stops at the start of a line does not include that line).
 * @param path - absolute file path.
 * @param selection - 0-based VS Code selection.
 * @returns the harness input reference.
 */
export function formatSelectionReference(path: string, selection: SelectionLines): string {
  const first = selection.startLine + 1
  const last = selection.endLine + (selection.endCharacter === 0 && selection.endLine > selection.startLine ? 0 : 1)
  return first === last ? `${path}:${String(first)}` : `${path}:${String(first)}-${String(last)}`
}
