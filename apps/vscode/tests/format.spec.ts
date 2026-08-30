import { describe, expect, it } from 'vitest'
import { formatSelectionReference } from '../src/format'

const PATH = 'c:\\g-workspace\\Heyang-Projects\\All-Wiki\\余烬狩猎.md'

describe('formatSelectionReference', () => {
  it('formats a single-line selection as path:line', () => {
    expect(formatSelectionReference(PATH, { startLine: 52, startCharacter: 0, endLine: 52, endCharacter: 5 }))
      .toBe(`${PATH}:53`)
  })

  it('formats an empty caret as the current line', () => {
    expect(formatSelectionReference(PATH, { startLine: 52, startCharacter: 3, endLine: 52, endCharacter: 3 }))
      .toBe(`${PATH}:53`)
  })

  it('formats a multi-line selection as an inclusive path:start-end range', () => {
    expect(formatSelectionReference(PATH, { startLine: 52, startCharacter: 0, endLine: 62, endCharacter: 12 }))
      .toBe(`${PATH}:53-63`)
  })

  it('does not include a line the selection only stops at the start of', () => {
    expect(formatSelectionReference(PATH, { startLine: 52, startCharacter: 0, endLine: 63, endCharacter: 0 }))
      .toBe(`${PATH}:53-63`)
  })
})
