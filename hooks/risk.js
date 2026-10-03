// Decides which toasts to show when the repository state changes. Pure.
// A toast fires only when a risky state appears, not while it lasts.

/** @type {import('./git-state.js').PulseState} */
const CLEAN = Object.freeze({
  isRepo: true, branch: '', sha: null, dirty: 0,
  hasUpstream: false, ahead: 0, behind: 0, conflicts: 0, op: null,
})

/**
 * @param {import('./git-state.js').PulseState | null} prev null on the first refresh
 * @param {import('./git-state.js').PulseState} next
 * @returns {string[]}
 */
export function diff(prev, next) {
  if (!next.isRepo) return []
  const before = prev && prev.isRepo ? prev : CLEAN
  const messages = []

  if (before.conflicts === 0 && next.conflicts > 0) {
    messages.push('Merge conflict in ' + next.conflicts + ' file(s)')
  }
  if (before.op !== 'merge' && next.op === 'merge') messages.push('Merge in progress')
  if (before.op !== 'rebase' && next.op === 'rebase') messages.push('Rebase in progress')
  if (before.branch !== null && next.branch === null && next.op !== 'rebase') {
    messages.push('Detached HEAD at ' + (next.sha ?? 'unknown commit'))
  }
  return messages
}
