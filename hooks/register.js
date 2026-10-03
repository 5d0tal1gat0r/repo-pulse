// Repo Pulse: git health in the band above the prompt.
// This is the only file that calls the mods API. It runs git, keeps the last
// state, and hands the pure modules their inputs.
import { NOT_A_REPO, parse, sameState } from './git-state.js'
import { render } from './band.js'
import { diff } from './risk.js'

const DEBOUNCE_MS = 500
const POLL_MS = 30_000
const SLOW_POLL_MS = 120_000
const GIT_TIMEOUT_MS = 5_000
const VERSION_TIMEOUT_MS = 2_000
const STATUS_ARGV = ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch']
const GIT_DIR_ARGV = ['git', 'rev-parse', '--absolute-git-dir']

/** @type {import('./git-state.js').PulseState | null} */
let prev = null
let isSlow = false
let inFlight = false
let rerun = false
let pendingTimer = null
let pollTimer = null
let pollMs = 0
let gitMissingLogged = false
let parseErrorLogged = false
/** @type {Map<string, string>} cwd -> absolute git dir */
const gitDirCache = new Map()

function scheduleRefresh($) {
  if (pendingTimer) pendingTimer.cancel()
  pendingTimer = $.clock.after(DEBOUNCE_MS, () => {
    pendingTimer = null
    void refresh($)
  })
}

function setPoll($, ms) {
  if (pollTimer && pollMs === ms) return
  if (pollTimer) pollTimer.cancel()
  pollMs = ms
  pollTimer = $.clock.every(ms, () => scheduleRefresh($))
}

function setSlow($, slow) {
  if (isSlow === slow) return
  isSlow = slow
  setPoll($, slow ? SLOW_POLL_MS : POLL_MS)
  $.ui.invalidate('ui.render')
}

async function refresh($) {
  if (inFlight) {
    rerun = true
    return
  }
  inFlight = true
  try {
    const next = await readState($)
    if (next) await commit($, next)
  } catch (err) {
    if (!parseErrorLogged) {
      parseErrorLogged = true
      $.ui.log('could not read git status: ' + (err && err.message ? err.message : String(err)))
    }
  } finally {
    inFlight = false
  }
  if (rerun) {
    rerun = false
    await refresh($)
  }
}

// Resolves the new state, or null to keep the previous one (git was slow).
async function readState($) {
  const cwd = await $.session.cwd()
  const opts = { cwd, timeoutMs: GIT_TIMEOUT_MS }
  const cachedDir = gitDirCache.get(cwd)

  let status
  let dirRun
  try {
    ;[status, dirRun] = await Promise.all([
      $.process.run(STATUS_ARGV, opts),
      cachedDir ? null : $.process.run(GIT_DIR_ARGV, opts),
    ])
  } catch {
    return onRunRejected($, cwd)
  }

  setSlow($, false)
  if (status.exitCode !== 0 || (dirRun && dirRun.exitCode !== 0)) return NOT_A_REPO

  const gitDir = cachedDir ?? dirRun.stdout.trim()
  gitDirCache.set(cwd, gitDir)
  const [mergeHead, rebaseMerge, rebaseApply] = await Promise.all([
    $.fs.exists(gitDir + '/MERGE_HEAD'),
    $.fs.exists(gitDir + '/rebase-merge'),
    $.fs.exists(gitDir + '/rebase-apply'),
  ])
  return parse(status.stdout, { mergeHead, rebaseMerge, rebaseApply })
}

// A run rejected: either git can't start (missing) or it timed out (slow repo).
async function onRunRejected($, cwd) {
  try {
    await $.process.run(['git', '--version'], { cwd, timeoutMs: VERSION_TIMEOUT_MS })
  } catch {
    if (!gitMissingLogged) {
      gitMissingLogged = true
      $.ui.log('git was not found, so the band is hidden')
    }
    return NOT_A_REPO
  }
  setSlow($, true)
  return null
}

async function commit($, next) {
  if (prev && sameState(prev, next)) return
  const messages = diff(prev, next)
  prev = next
  $.ui.invalidate('ui.render')
  for (const message of messages) await $.ui.toast(message)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    setPoll($, POLL_MS)
    scheduleRefresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // No .catch here: a retry would run the tool twice. Only next() can throw.
  on('tool.call', { tool: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'] }, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      try {
        scheduleRefresh($)
      } catch {
        // Never let a refresh problem affect the tool call.
      }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    scheduleRefresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    scheduleRefresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const row = prev ? render(prev, e.props.bodyColumns) : null
    if (!row) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const textProps = isSlow ? { dimColor: true } : {}
    const children = [Text({ ...textProps, wrap: 'truncate-end', children: [row.text] })]
    if (row.badge) children.push(Text({ color: 'warning', bold: true, children: [row.badge] }))
    const ours = Box({ key: 'repo-pulse', flexDirection: 'row', columnGap: 1, children })

    // Keep what the mods after this one draw in the band.
    const theirs = await next(e)
    return Box({ flexDirection: 'column', children: theirs ? [ours, theirs] : [ours] })
  }).catch(($, e, next) => next(e))
}
