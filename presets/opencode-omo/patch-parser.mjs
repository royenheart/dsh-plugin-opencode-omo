/**
 * The one parser for the opencode freeform apply_patch grammar.
 *
 * Permission checks and execution must consume this result instead of
 * re-parsing `patch_text` with a second regex: the two grammars would drift
 * on CR/LS/PS, optional colons, and future syntax.
 */
export function parsePatch(patchText) {
  const text = String(patchText ?? '')
  const ops = []
  let current
  // Match the executor's line model: only CRLF/LF separate patch lines; a
  // lone CR/LS/PS is header whitespace that the header regex consumes.
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('*** Begin Patch') || line.trim() === '') continue
    if (line.startsWith('*** End Patch')) break
    const addMatch = line.match(/^\*\*\* Add File:?\s*(.*)$/)
    const delMatch = line.match(/^\*\*\* Delete File:?\s*(.*)$/)
    const updMatch = line.match(/^\*\*\* Update File:?\s*(.*)$/)
    const movMatch = line.match(/^\*\*\* Move to:?\s*(.*)$/)
    if (addMatch) {
      current = { kind: 'add', path: addMatch[1].trim(), lines: [] }
      ops.push(current)
    } else if (delMatch) {
      current = { kind: 'delete', path: delMatch[1].trim() }
      ops.push(current)
    } else if (updMatch) {
      current = { kind: 'update', path: updMatch[1].trim(), moveTo: undefined, hunks: [] }
      ops.push(current)
    } else if (movMatch) {
      if (current?.kind === 'update') current.moveTo = movMatch[1].trim()
    } else if (line.startsWith('@@')) {
      if (current?.kind === 'update') current.hunks.push({ context: line.slice(2).trim(), old: [], new: [] })
    } else if (line.startsWith('+')) {
      if (current?.kind === 'add') current.lines.push(line.slice(1))
      else if (current?.kind === 'update') current.hunks[current.hunks.length - 1]?.new.push(line.slice(1))
    } else if (line.startsWith('-')) {
      if (current?.kind === 'update') current.hunks[current.hunks.length - 1]?.old.push(line.slice(1))
    }
  }
  return ops
}
