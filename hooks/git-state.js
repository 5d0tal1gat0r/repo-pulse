// Turns `git status --porcelain=v2 --branch` output into a PulseState.
// Pure: no I/O. The caller supplies which in-progress marker files exist.

/**
 * @typedef {{ isRepo: boolean, branch: string | null, sha: string | null,
 *   dirty: number, hasUpstream: boolean, ahead: number, behind: number,
 *   conflicts: number, op: null | 'merge' | 'rebase' }} PulseState
 */

/** @type {PulseState} */
export const NOT_A_REPO = Object.freeze({
  isRepo: false, branch: null, sha: null, dirty: 0,
  hasUpstream: false, ahead: 0, behind: 0, conflicts: 0, op: null,
})

const FIELDS = Object.keys(NOT_A_REPO)

/**
 * @param {string} statusOutput
 * @param {{ mergeHead: boolean, rebaseMerge: boolean, rebaseApply: boolean }} markers
 * @returns {PulseState}
 */
export function parse(statusOutput, markers) {
  const state = { ...NOT_A_REPO, isRepo: true }
  let sawHead = false

  for (const line of statusOutput.split('\n')) {
    if (line === '') continue
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length)
      state.sha = oid === '(initial)' ? null : oid.slice(0, 7)
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      state.branch = head === '(detached)' ? null : head
      sawHead = true
    } else if (line.startsWith('# branch.upstream ')) {
      state.hasUpstream = true
    } else if (line.startsWith('# branch.ab ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (!m) throw new Error('unrecognised branch.ab line: ' + line)
      state.ahead = Number(m[1])
      state.behind = Number(m[2])
    } else if (line.startsWith('# ') || line.startsWith('! ')) {
      // Other headers (such as # stash) and ignored files don't affect the band.
    } else if (line.startsWith('u ')) {
      state.dirty += 1
      state.conflicts += 1
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('? ')) {
      state.dirty += 1
    } else {
      throw new Error('unrecognised status line: ' + line)
    }
  }

  if (!sawHead) throw new Error('git status output has no branch.head line')
  state.op = markers.rebaseMerge || markers.rebaseApply ? 'rebase' : markers.mergeHead ? 'merge' : null
  return state
}

/**
 * @param {PulseState} a
 * @param {PulseState} b
 */
export function sameState(a, b) {
  return FIELDS.every((k) => a[k] === b[k])
}
