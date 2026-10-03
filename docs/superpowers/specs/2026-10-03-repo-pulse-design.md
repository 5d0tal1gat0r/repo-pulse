# Repo Pulse — design

Date: 2026-10-03
Status: approved in brainstorming, pending spec review

## Goal

A Claude Code plugin, published publicly in the Claude plugin directory, that
shows glanceable local git health in a band above the prompt and raises a toast
when the repository enters a risky state.

## Scope

### In scope (v1)

- Local git state only. No network calls, no forge APIs, no `git fetch`.
- A one-row band above the prompt: `branch · ±dirty · ↑ahead ↓behind`, plus a
  risk badge (for example `⚠ REBASE`) when one applies.
- A toast when a risky state appears: merge conflict, detached HEAD, merge in
  progress, rebase in progress.
- Claude Code terminal and Desktop Code tab (the surfaces that draw mods).

### Out of scope (v1)

- CI status and pull request review status (GitHub or any other forge).
- Drift toasts (falling behind upstream, dirty-count thresholds).
- Status line output, live pane, configurable fields, `userConfig`.
- Filesystem watching of `.git/`.

These are candidates for later versions; v1 must not build hooks for them.

## Decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Data source | Local git only | No auth, no rate limits, no credential policy holds in directory review |
| Toast trigger | Risky state appears | Rare, high-signal events that are easy to miss mid-session |
| Surface | Band only (`AbovePrompt`) | Does not fight users' existing custom status lines |
| Band content | Minimal fields | Fits narrow terminals; one row |
| Refresh | Hook events + 30 s poll | Fresh after Claude's edits; catches changes from other terminals |

## Directory constraints (verified 2026-10-03)

From the plugin pre-submission checklist and the mods docs:

- `hooks/hooks.json` with a `modules` array is an accepted plugin component.
- The plugin lives at the repository root. A hook module that is not a shell
  script is only held for review when the plugin is in a subfolder.
- Every non-image file under 256 KiB, readable (not minified) source, no
  lockfile installs, no package launchers.
- README of at least 40 words that discloses everything the plugin runs,
  sends, or fetches. A LICENSE file or `license` in `plugin.json`.
- Name `repo-pulse`: lowercase, hyphenated, not a reserved word.
- Requires Claude Code v2.1.287 or later (mods).

## Architecture

```
repo-pulse/                  repository root = plugin root
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json           { "modules": ["./register.js"] }
│   ├── register.js          wiring: events, timers, process calls, render, toast
│   ├── git-state.js         pure: git output + marker flags -> PulseState
│   ├── band.js              pure: PulseState + width -> band row model
│   └── risk.js              pure: (prev, next) -> toast messages
├── test/
│   ├── fixtures/            captured porcelain v2 output per scenario
│   ├── capture-fixtures.sh  dev-only fixture generator
│   └── *.test.ts            claude plugin test suites
├── .github/workflows/ci.yml
├── README.md
└── LICENSE                  MIT
```

Only `register.js` touches the mods API (`$`). The three other modules are pure
functions with no I/O, so they are unit-tested directly.

Open item to confirm during implementation: the hooks module imports sibling
files with relative ES module imports (`import { parse } from './git-state.js'`).
If the loader refuses relative imports, inline the three units into
`register.js` and export them for tests instead.

### PulseState

```ts
type PulseState = {
  isRepo: boolean
  branch: string | null      // null when HEAD is detached
  sha: string | null         // short oid; null in a repo with no commits
  dirty: number              // changed + renamed + unmerged + untracked entries
  hasUpstream: boolean
  ahead: number
  behind: number
  conflicts: number          // count of porcelain v2 'u' entries
  op: null | 'merge' | 'rebase'
}
```

### git-state.js

`parse(statusOutput: string, markers: { mergeHead: boolean, rebaseMerge: boolean, rebaseApply: boolean }): PulseState`

- Reads `# branch.oid`, `# branch.head`, `# branch.upstream`, `# branch.ab`.
- `branch.head (detached)` yields `branch: null`.
- `branch.oid (initial)` yields `sha: null`.
- Counts entries starting with `1 `, `2 `, `u `, `? ` into `dirty`; `u ` also
  into `conflicts`. Ignored entries (`! `) are not counted.
- `op` is `rebase` if either rebase marker exists, else `merge` if
  `MERGE_HEAD` exists, else `null`.
- Throws on output it cannot recognise; the caller handles it.

`NOT_A_REPO: PulseState` is a constant with `isRepo: false` and zeroed fields.

### band.js

`render(state: PulseState, columns: number): { text: string, badge: string | null } | null`

- Returns `null` when `!state.isRepo`.
- Branch label: the branch name, or `HEAD@<sha>` when detached.
- Segments joined with ` · `: label, `±N` (omitted when 0), `↑A ↓B` (omitted
  when no upstream; each arrow omitted when its count is 0).
- Badge: `⚠ CONFLICT` when `conflicts > 0`, else `⚠ REBASE` / `⚠ MERGE` from
  `op`, else `⚠ DETACHED` when detached and no op, else `null`.
- When the row is wider than `columns`, the branch label is shortened in the
  middle with `…`; badge and counts are kept.

### risk.js

`diff(prev: PulseState | null, next: PulseState): string[]`

`prev === null` means first refresh of the session and is treated as a clean
repository. Messages, in this order:

- `conflicts` goes from 0 to more than 0: `Merge conflict in N file(s)`.
- `op` goes from not-`merge` to `merge`: `Merge in progress`.
- `op` goes from not-`rebase` to `rebase`: `Rebase in progress`.
- Branch goes from named to detached while `op !== 'rebase'`:
  `Detached HEAD at <sha>`.

A state that persists across refreshes produces no further toasts. Returns
`[]` when `!next.isRepo`.

### register.js

Module state: `prev`, `gitDirCache` (map from cwd to absolute git dir),
`pendingTimer`, `inFlight`, `rerun`, `pollTimer`, `pollMs`, `isSlow`,
`gitMissingLogged`.

Events:

| Event | Behavior |
|---|---|
| `session.start` | Refresh immediately, start `$.clock.every(30_000, scheduleRefresh)`, return `next(e)` |
| `tool.call` for `Bash`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `const r = await next(e)`, `scheduleRefresh()`, `return r`. Never alters the call |
| `prompt.submit` | `scheduleRefresh()`, return `next(e)` |
| `turn.complete` | `scheduleRefresh()`, return `next(e)` |
| `ui.render` with `{ component: 'AbovePrompt' }` | Draw the band (see below) |

`scheduleRefresh()` cancels `pendingTimer` and sets
`pendingTimer = $.clock.after(500, refresh)`.

`refresh()`:

1. If `inFlight`, set `rerun = true` and return.
2. Set `inFlight = true`. Read `cwd = $.session.cwd()`.
3. Run in parallel with `timeoutMs: 5000`:
   - `git --no-optional-locks status --porcelain=v2 --branch`
   - `git rev-parse --absolute-git-dir` (skipped when cached for `cwd`)
4. A non-zero exit from either command means "not a repository": `next = NOT_A_REPO`.
5. Otherwise check `MERGE_HEAD`, `rebase-merge`, `rebase-apply` under the git
   dir with `$.fs.exists`, then `next = parse(...)`.
6. If `next` differs from `prev` (field-wise), call
   `$.ui.invalidate('ui.render')` and toast each message from
   `risk.diff(prev, next)` with `$.ui.toast`.
7. `prev = next`. Clear `inFlight`; if `rerun`, clear it and call `refresh()` again.

`--no-optional-locks` is required so the plugin never holds `index.lock` while
Claude runs git commands.

Band render:

- Compute `row = band.render(prev, e.props.bodyColumns)`.
- If `row` is `null`, return `next(e)`.
- Draw one `Box` row: `Text` with `row.text` (dimmed when `isSlow`), then a
  `Text` with `row.badge` and `color: 'warning'` when present.
- Keep other mods' band content: `const theirs = await next(e)` and return a
  column `Box` with our row first and `theirs` below it.

## Error handling

| Case | Behavior |
|---|---|
| Not a repository (git exits non-zero) | `NOT_A_REPO`; band hidden; no toast |
| `git` not installed (`$.process.run` rejects with a start error) | Treated as `NOT_A_REPO`; one `$.ui.log` line per session; polling continues |
| `git status` exceeds 5 s | Keep `prev`, set `isSlow` (band dims), poll interval becomes 120 s; the next refresh under 5 s clears `isSlow` and restores 30 s |
| `parse` throws | Keep `prev`; write one debug log line; never throw out of a hook |
| No upstream | Ahead/behind segment hidden |
| Working directory changes between refreshes | `cwd` is read on every refresh; git dir cache is keyed by `cwd` |

No hook may throw. `register.js` wraps refresh work in `try`/`catch`, and every
hook registration has a `.catch` handler that passes the event on unchanged.

## Testing

All suites run with `claude plugin test`.

- `git-state.test.ts`: parser against fixtures for clean, dirty, untracked
  only, detached, initial repository, no upstream, ahead/behind, conflicts,
  mid-merge, mid-rebase.
- `band.test.ts`: segment layout, upstream hiding, each badge, middle
  truncation at narrow widths.
- `risk.test.ts`: transition table, including first refresh, persistent state
  (no repeat toast), and detached suppression during rebase.
- `register.test.ts`: with stubbed `$.process`, `$.fs`, `$.clock`, `$.session`:
  a burst of tool calls produces one refresh; refreshes never overlap; timeout
  sets slow mode and backs off; missing git logs once; `tool.call` results pass
  through unchanged; other mods' band content is kept.
- `test/capture-fixtures.sh`: builds temporary repositories in each state with
  real `git merge` and `git rebase` (forced conflict) and writes the fixtures.
  Dev-only; never run by the plugin.
- Manual smoke: `claude --plugin-dir .` against a scratch repository driven
  through each state.

## CI

`.github/workflows/ci.yml` runs on push and pull request:
`claude plugin validate . --strict` and `claude plugin test`. After the
directory listing goes live, merges to `main` auto-publish, so `main` stays
green.

## Packaging and publishing

- `plugin.json`: `name: "repo-pulse"`, `version: "0.1.0"`, `description`,
  `author`, `license: "MIT"`.
- `README.md` discloses: runs `git status` and `git rev-parse` locally on each
  refresh; makes no network requests; stores nothing; sends nothing. States
  Claude Code only, v2.1.287 or later, and that the VS Code chat panel and
  `claude -p` run the hooks but draw nothing.
- Raise `version` with every release.
- Repository: `github.com/5d0tal1gat0r/repo-pulse`, private during development.

Publishing steps:

1. `claude plugin validate . --strict` passes locally.
2. Developer portal → Submit new → Plugin bundle → Validate (private repo needs
   the Claude GitHub App installed).
3. Fix every blocking finding and re-validate.
4. Submit. Data handling answers: no personal data, nothing sent to third
   parties, nothing retained.
5. After review passes, make the repository public and select Publish.

## Success criteria

- In a repository, the band shows the correct branch, dirty count and
  ahead/behind within about 1 s of Claude editing a file, and within 30 s of a
  change made in another terminal.
- Each risky state produces exactly one toast when it appears.
- Outside a repository, or without git, the plugin draws nothing and logs at
  most one line.
- `claude plugin validate . --strict` and `claude plugin test` pass.
- The developer portal validation reports no blocking findings.
