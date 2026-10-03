# Repo Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `repo-pulse` Claude Code mod: a one-row band above the prompt showing local git health, plus a toast when a merge, rebase, conflict or detached HEAD appears.

**Architecture:** A plugin at the repository root whose `hooks/hooks.json` names one hooks module, `hooks/register.js`. That module is the only code that touches the mods API (`$`). It imports three pure ES modules (`git-state.js`, `band.js`, `risk.js`) that turn `git status --porcelain=v2 --branch` output into a state object, a band row, and toast messages. Refreshes are triggered by tool calls, prompts, turn ends and a 30 s poll, debounced to 500 ms.

**Tech Stack:** Plain JavaScript ES modules (no build, no dependencies), Claude Code mods API v2.1.287, `claude plugin test` (TypeScript test files using `claude-code/testing`), `claude plugin validate`, Bash + `jq` for the dev-only fixture script, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-repo-pulse-design.md`

## Global Constraints

- Plugin root is the repository root. Plugin name: `repo-pulse`.
- Requires Claude Code v2.1.287 or later.
- No dependencies, no `package.json`, no lockfile, no build step, no minified code.
- Every non-image file under 256 KiB.
- The plugin makes no network requests, uses no `$.store`, no `userConfig`.
- Only git commands run: `git --no-optional-locks status --porcelain=v2 --branch`, `git rev-parse --absolute-git-dir`, and `git --version` (only after a failed run).
- `--no-optional-locks` on every `git status` call.
- Hooks-module rules from the mods validator: write every mods API call in full (`$.ui.toast(...)`), never assign or destructure `$` or a namespace, event names in `on()` are string literals, `$` may only be passed to functions declared at the top level of `register.js`, imports are top-level `import` declarations of relative paths.
- No hook may throw. Hooks other than `tool.call` get a `.catch(($, e, next) => next(e))`. `tool.call` gets none, because a retry from `.catch` would run the tool a second time; its body cannot throw except from `next` itself.
- Timer callbacks never return the refresh promise (`() => { void refresh($) }`), so the mock clock never waits on git.
- Two deliberate refinements of the spec: `session.start` schedules the first refresh (500 ms debounce) instead of running it inline, so session start never waits on git; and `risk.diff` treats a previous non-repository state like `null` (clean), so moving into a repository mid-rebase still toasts.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <session-link>
  ```
- Work on branch `feat/v0.1`; open one PR into `main` at the end.

## Review Focus

1. **Upstream deleted on the remote** (`# branch.upstream` present, no `# branch.ab`): expect no crash and no arrows. Pinned in Task 3.
2. **Paths with spaces or quotes in status output** (`1 .M ... "a b.txt"`): expect them counted as dirty, not rejected as unrecognised lines. Pinned in Task 3.
3. **`git am` or `git rebase --apply`** (`rebase-apply/` marker only): expect `op: 'rebase'`. Pinned in Task 3.
4. **A conflict that is resolved and then reappears**: expect a second toast, but no toast while the count only changes. Pinned in Task 5.
5. **Branch names that already fit, including non-ASCII** (`feat/ünï`): expect them shown unchanged; only overflow is shortened. Pinned in Task 4.

---

### Task 1: Scaffold the plugin and confirm the API shapes

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `hooks/register.js` (minimal; Task 6 replaces it)
- Create: `test/scaffold.test.ts`
- Create: `.gitignore`
- Create: `LICENSE`

**Interfaces:**
- Consumes: nothing.
- Produces: a loadable plugin directory; confirmed call shapes listed in Step 3 that Tasks 6–7 rely on.

- [ ] **Step 1: Create the branch**

```bash
cd <plugin-dir>
git checkout -b feat/v0.1
```

- [ ] **Step 2: Write the scaffold files**

`.claude-plugin/plugin.json`:

```json
{
  "name": "repo-pulse",
  "version": "0.1.0",
  "description": "Glanceable git health above the Claude Code prompt: branch, dirty files, ahead/behind, and a toast when a merge, rebase, conflict or detached HEAD appears.",
  "author": { "name": "5d0tal1gat0r", "url": "https://github.com/5d0tal1gat0r" },
  "homepage": "https://github.com/5d0tal1gat0r/repo-pulse",
  "repository": "https://github.com/5d0tal1gat0r/repo-pulse",
  "license": "MIT",
  "keywords": ["git", "status", "band", "mod"]
}
```

`hooks/hooks.json`:

```json
{
  "description": "Repo Pulse hooks module",
  "modules": ["./register.js"]
}
```

`hooks/register.js`:

```javascript
// Repo Pulse: git health in the band above the prompt.
export function register(on) {
  on('tool.call', async ($, e, next) => next(e))
}
```

`.gitignore` (Claude Code writes these when the directory is loaded with `--plugin-dir`):

```
.claude-plugin/types/
tsconfig.json
```

`LICENSE`:

```
MIT License

Copyright (c) 2026 5d0tal1gat0r

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`test/scaffold.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'

test('the module loads and passes tool calls through', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out).toEqual({ result: 'ran' })
})
```

- [ ] **Step 3: Confirm the API shapes this plan assumes**

Fetch the published declarations into the scratchpad (not the repo) and search them:

```bash
D=<scratch>
curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/mods/types/claude-code.d.ts -o "$D/claude-code.d.ts"
head -1 "$D/claude-code.d.ts"
grep -n -A6 "cwd(" "$D/claude-code.d.ts" | head -20
grep -n -B2 -A14 "run(argv" "$D/claude-code.d.ts" | head -40
grep -n -A6 "exists(" "$D/claude-code.d.ts" | head -12
grep -n -A6 "toast(" "$D/claude-code.d.ts" | head -12
grep -n -A6 "after(" "$D/claude-code.d.ts" | head -12
grep -n "warning" "$D/claude-code.d.ts" | head -10
grep -n -B2 -A10 "ToolCallMatcher\|tool?: " "$D/claude-code.d.ts" | head -30
```

Check each assumption and record the result in the PR description later:

| Assumption used in Tasks 6–7 | Expected |
|---|---|
| `await $.session.cwd()` | Returns the session working directory as a string |
| `$.process.run(argv, { cwd, timeoutMs })` | Resolves `{ exitCode, stdout, stderr }`; rejects when the program cannot start or times out |
| `await $.fs.exists(path)` | Resolves a boolean |
| `$.ui.toast(text)`, `$.ui.log(text)` | Take a string |
| `$.clock.after(ms, fn)`, `$.clock.every(ms, fn)` | Return a timer with `cancel()` synchronously |
| `Text` `color: 'warning'` | `warning` is a theme key |
| `on('tool.call', { tool: [...] }, ...)` | A matcher field accepts an array of values |

If one differs, adapt only the call site in Tasks 6–7 to the declared shape (for example, a different option name). If `warning` is not a theme key, use `'yellow'`. If array matchers are not allowed, register one `on('tool.call', { tool: 'Bash' }, onMutatingTool)` per tool name with a shared top-level handler function.

- [ ] **Step 4: Probe the validator rules this plan relies on, outside the repo**

```bash
P=<scratch>/probe
mkdir -p "$P/.claude-plugin" "$P/hooks"
echo '{"name":"probe-mod","version":"0.0.1","description":"probe","author":{"name":"x"}}' > "$P/.claude-plugin/plugin.json"
echo '{"modules":["./register.js"]}' > "$P/hooks/hooks.json"
echo 'export const double = (n) => n * 2' > "$P/hooks/util.js"
cat > "$P/hooks/register.js" <<'EOF'
import { double } from './util.js'
let timer = null
function later($) {
  if (timer) timer.cancel()
  timer = $.clock.after(500, () => { void work($) })
}
async function work($) {
  const cwd = await $.session.cwd()
  await $.process.run(['git', '--version'], { cwd, timeoutMs: 2000 })
  $.ui.toast('n=' + double(2))
}
export function register(on) {
  on('tool.call', { tool: ['Bash', 'Edit'] }, async ($, e, next) => {
    try { return await next(e) } finally { later($) }
  })
  on('prompt.submit', async ($, e, next) => { later($); return next(e) })
    .catch(($, e, next) => next(e))
}
EOF
claude plugin validate "$P" --strict
```

Expected: `✔ Validation passed`, with a `calls:` line that lists `$.clock.after`, `$.session.cwd`, `$.process.run` and `$.ui.toast` (some marked `via later` / `via work`). If validation rejects the nested `() => { void work($) }` closure, restructure Tasks 6–7 so that each timer callback calls a top-level function directly with `$` (for example `$.clock.after(500, () => refreshFromTimer($))`), and re-run this probe until it passes. Delete the probe afterwards: `rm -rf "$P"`.

- [ ] **Step 5: Validate and test the scaffold**

```bash
claude plugin validate . --strict
claude plugin test
```

Expected: `✔ Validation passed`; `1 pass`, `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json hooks/hooks.json hooks/register.js test/scaffold.test.ts .gitignore LICENSE
git commit -m "Scaffold repo-pulse plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 2: Capture real git fixtures

**Files:**
- Create: `test/capture-fixtures.sh`
- Create (generated): `test/fixtures.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `test/fixtures.ts` exporting

  ```ts
  export type Fixture = { status: string; markers: { mergeHead: boolean; rebaseMerge: boolean; rebaseApply: boolean } }
  export const fixtures: Record<string, Fixture>
  ```

  with keys `clean`, `dirty`, `untracked`, `rename`, `ahead_behind`, `no_upstream`, `detached`, `initial`, `merge_conflict`, `rebase_conflict`.

- [ ] **Step 1: Write the capture script**

`test/capture-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Dev-only. Builds throwaway repositories in each state Repo Pulse handles and
# writes their real `git status --porcelain=v2 --branch` output and marker files
# to test/fixtures.ts. The plugin never runs this script.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/fixtures.ts"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Isolate from the developer's git config and make commits deterministic.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.com
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.com
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'

g() { git -c init.defaultBranch=main -c advice.detachedHead=false -c merge.conflictStyle=merge "$@"; }
exists() { if [ -e "$1" ]; then echo true; else echo false; fi; }

capture() {
  local name=$1 dir=$2 gd status
  gd="$(g -C "$dir" rev-parse --absolute-git-dir)"
  status="$(g -C "$dir" --no-optional-locks status --porcelain=v2 --branch)"
  printf '  %s: {\n    status: %s,\n    markers: { mergeHead: %s, rebaseMerge: %s, rebaseApply: %s },\n  },\n' \
    "$name" "$(printf '%s\n' "$status" | jq -Rs .)" \
    "$(exists "$gd/MERGE_HEAD")" "$(exists "$gd/rebase-merge")" "$(exists "$gd/rebase-apply")" >> "$out"
}

# Clone the shared origin into a fresh working copy that tracks origin/main.
fresh() { g clone -q "$tmp/origin.git" "$tmp/$1"; }

# A file both sides of a merge or rebase change, to force a conflict.
diverge() {
  local d=$1
  g -C "$d" checkout -qb side
  echo side > "$d/a.txt"; g -C "$d" commit -qam side
  g -C "$d" checkout -q main
  echo main > "$d/a.txt"; g -C "$d" commit -qam main
}

cat > "$out" <<'EOF'
// Generated by test/capture-fixtures.sh. Do not edit by hand.
export type Fixture = { status: string; markers: { mergeHead: boolean; rebaseMerge: boolean; rebaseApply: boolean } }
export const fixtures: Record<string, Fixture> = {
EOF

g init -q --bare "$tmp/origin.git"
g clone -q "$tmp/origin.git" "$tmp/seed" 2>/dev/null
echo one > "$tmp/seed/a.txt"; echo x > "$tmp/seed/b.txt"
g -C "$tmp/seed" add .; g -C "$tmp/seed" commit -qm one; g -C "$tmp/seed" push -q -u origin main

# Cloned before origin moves, so it ends up behind.
fresh ahead_behind

fresh clean
capture clean "$tmp/clean"

fresh dirty
echo changed >> "$tmp/dirty/a.txt"
echo staged > "$tmp/dirty/b.txt"; g -C "$tmp/dirty" add b.txt
echo new > "$tmp/dirty/new.txt"
capture dirty "$tmp/dirty"

fresh untracked
echo new > "$tmp/untracked/new.txt"
capture untracked "$tmp/untracked"

fresh rename
g -C "$tmp/rename" mv b.txt c.txt
capture rename "$tmp/rename"

# Move origin two commits ahead, then make one local commit and fetch.
echo two > "$tmp/seed/b.txt"; g -C "$tmp/seed" commit -qam two
echo three > "$tmp/seed/b.txt"; g -C "$tmp/seed" commit -qam three
g -C "$tmp/seed" push -q
echo local > "$tmp/ahead_behind/c.txt"; g -C "$tmp/ahead_behind" add c.txt; g -C "$tmp/ahead_behind" commit -qm local
g -C "$tmp/ahead_behind" fetch -q
capture ahead_behind "$tmp/ahead_behind"

fresh no_upstream
g -C "$tmp/no_upstream" checkout -qb feature
capture no_upstream "$tmp/no_upstream"

fresh detached
g -C "$tmp/detached" checkout -q --detach
capture detached "$tmp/detached"

g init -q "$tmp/initial"
capture initial "$tmp/initial"

fresh merge_conflict
diverge "$tmp/merge_conflict"
g -C "$tmp/merge_conflict" merge -q side >/dev/null 2>&1 || true
capture merge_conflict "$tmp/merge_conflict"

fresh rebase_conflict
diverge "$tmp/rebase_conflict"
g -C "$tmp/rebase_conflict" checkout -q side
g -C "$tmp/rebase_conflict" rebase main >/dev/null 2>&1 || true
capture rebase_conflict "$tmp/rebase_conflict"

echo '}' >> "$out"
echo "wrote $out"
```

- [ ] **Step 2: Run it and inspect the output**

```bash
chmod +x test/capture-fixtures.sh
test/capture-fixtures.sh
cat test/fixtures.ts
```

Expected, per key:
- `clean`: has `# branch.head main`, `# branch.upstream origin/main`, `# branch.ab +0 -0`, no entry lines.
- `dirty`: three entry lines (two `1 ` lines and one `? new.txt`).
- `untracked`: one `? new.txt` line.
- `rename`: one `2 R. ` line.
- `ahead_behind`: `# branch.ab +1 -2`.
- `no_upstream`: `# branch.head feature`, no `branch.upstream` line.
- `detached`: `# branch.head (detached)`.
- `initial`: `# branch.oid (initial)` and `# branch.head main`.
- `merge_conflict`: one `u ` line; `mergeHead: true`.
- `rebase_conflict`: `# branch.head (detached)`, one `u ` line; `rebaseMerge: true`.

If any key differs, fix the script, not the fixture file.

- [ ] **Step 3: Commit**

```bash
git add test/capture-fixtures.sh test/fixtures.ts
git commit -m "Add git status fixture generator and fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 3: Parse git status into PulseState

**Files:**
- Create: `hooks/git-state.js`
- Test: `test/git-state.test.ts`

**Interfaces:**
- Consumes: `fixtures` from `test/fixtures.ts` (tests only).
- Produces:
  - `parse(statusOutput: string, markers: { mergeHead: boolean, rebaseMerge: boolean, rebaseApply: boolean }): PulseState` — throws `Error` on unrecognised output.
  - `NOT_A_REPO: PulseState` (frozen).
  - `sameState(a: PulseState, b: PulseState): boolean`.
  - `PulseState = { isRepo, branch: string|null, sha: string|null, dirty, hasUpstream, ahead, behind, conflicts, op: null|'merge'|'rebase' }`.

- [ ] **Step 1: Write the failing tests**

`test/git-state.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'
import { NOT_A_REPO, parse, sameState } from '../hooks/git-state.js'
import { fixtures } from './fixtures.ts'

const NO_MARKERS = { mergeHead: false, rebaseMerge: false, rebaseApply: false }
const fx = (name: string) => parse(fixtures[name].status, fixtures[name].markers)

test('clean repository with upstream', () => {
  const s = fx('clean')
  expect(s).toMatchObject({ isRepo: true, branch: 'main', dirty: 0, hasUpstream: true, ahead: 0, behind: 0, conflicts: 0, op: null })
  expect(s.sha).toMatch(/^[0-9a-f]{7}$/)
})

test('staged, unstaged and untracked entries all count as dirty', () => {
  expect(fx('dirty').dirty).toBe(3)
  expect(fx('untracked').dirty).toBe(1)
  expect(fx('rename').dirty).toBe(1)
})

test('ahead and behind come from branch.ab', () => {
  expect(fx('ahead_behind')).toMatchObject({ hasUpstream: true, ahead: 1, behind: 2 })
})

test('a branch with no upstream', () => {
  expect(fx('no_upstream')).toMatchObject({ branch: 'feature', hasUpstream: false, ahead: 0, behind: 0 })
})

test('detached HEAD has no branch but keeps the sha', () => {
  const s = fx('detached')
  expect(s.branch).toBe(null)
  expect(s.sha).toMatch(/^[0-9a-f]{7}$/)
})

test('a repository with no commits has no sha', () => {
  expect(fx('initial')).toMatchObject({ isRepo: true, branch: 'main', sha: null, hasUpstream: false })
})

test('merge conflict', () => {
  expect(fx('merge_conflict')).toMatchObject({ branch: 'main', conflicts: 1, dirty: 1, op: 'merge' })
})

test('rebase conflict is detached with op rebase', () => {
  expect(fx('rebase_conflict')).toMatchObject({ branch: null, conflicts: 1, op: 'rebase' })
})

test('rebase-apply alone means rebase', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', { ...NO_MARKERS, rebaseApply: true })
  expect(s.op).toBe('rebase')
})

test('rebase wins over a stale MERGE_HEAD', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', { mergeHead: true, rebaseMerge: true, rebaseApply: false })
  expect(s.op).toBe('rebase')
})

test('upstream deleted on the remote: no branch.ab line', () => {
  const s = parse('# branch.oid 0123456789abcdef\n# branch.head main\n# branch.upstream origin/gone\n', NO_MARKERS)
  expect(s).toMatchObject({ hasUpstream: true, ahead: 0, behind: 0 })
})

test('quoted paths with spaces count as dirty', () => {
  const out = '# branch.oid 0123456789abcdef\n# branch.head main\n' +
    '1 .M N... 100644 100644 100644 0123 0123 "a b.txt"\n' +
    '? "c \\"d\\".txt"\n'
  expect(parse(out, NO_MARKERS).dirty).toBe(2)
})

test('ignored entries and other header lines are skipped', () => {
  const out = '# branch.oid 0123456789abcdef\n# branch.head main\n# stash 2\n! build/\n'
  expect(parse(out, NO_MARKERS).dirty).toBe(0)
})

test('unrecognised output throws', () => {
  expect(() => parse('fatal: something\n', NO_MARKERS)).toThrow()
  expect(() => parse('# branch.oid 0123456789abcdef\n', NO_MARKERS)).toThrow()
  expect(() => parse('# branch.oid 0123\n# branch.head main\n# branch.ab nonsense\n', NO_MARKERS)).toThrow()
})

test('NOT_A_REPO is an empty, non-repo state', () => {
  expect(NOT_A_REPO).toMatchObject({ isRepo: false, branch: null, sha: null, dirty: 0, conflicts: 0, op: null })
})

test('sameState compares every field', () => {
  expect(sameState(fx('clean'), fx('clean'))).toBe(true)
  expect(sameState(fx('clean'), fx('dirty'))).toBe(false)
  expect(sameState(NOT_A_REPO, fx('clean'))).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test`
Expected: FAIL — `git-state.test.ts` cannot resolve `../hooks/git-state.js`.

- [ ] **Step 3: Write the implementation**

`hooks/git-state.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test`
Expected: all `git-state.test.ts` tests pass; `scaffold.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add hooks/git-state.js test/git-state.test.ts
git commit -m "Parse porcelain v2 status into PulseState

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 4: Render the band row

**Files:**
- Create: `hooks/band.js`
- Test: `test/band.test.ts`

**Interfaces:**
- Consumes: `PulseState`, `NOT_A_REPO` from `hooks/git-state.js`.
- Produces:
  - `render(state: PulseState, columns: number): { text: string, badge: string | null } | null`
  - `badgeFor(state: PulseState): string | null`
  - `truncateMiddle(s: string, max: number): string`

- [ ] **Step 1: Write the failing tests**

`test/band.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'
import { badgeFor, render, truncateMiddle } from '../hooks/band.js'
import { NOT_A_REPO } from '../hooks/git-state.js'

const BASE = { ...NOT_A_REPO, isRepo: true, branch: 'main', sha: 'abc1234', hasUpstream: true }

test('nothing outside a repository', () => {
  expect(render(NOT_A_REPO, 80)).toBe(null)
})

test('a clean branch shows only its name', () => {
  expect(render(BASE, 80)).toEqual({ text: 'main', badge: null })
})

test('dirty count', () => {
  expect(render({ ...BASE, dirty: 3 }, 80)!.text).toBe('main · ±3')
})

test('ahead and behind, each hidden at zero', () => {
  expect(render({ ...BASE, ahead: 1, behind: 2 }, 80)!.text).toBe('main · ↑1 ↓2')
  expect(render({ ...BASE, ahead: 1 }, 80)!.text).toBe('main · ↑1')
  expect(render({ ...BASE, behind: 4 }, 80)!.text).toBe('main · ↓4')
})

test('all segments together', () => {
  expect(render({ ...BASE, dirty: 2, ahead: 1, behind: 2 }, 80)!.text).toBe('main · ±2 · ↑1 ↓2')
})

test('no upstream hides ahead and behind', () => {
  expect(render({ ...BASE, branch: 'feature', hasUpstream: false, ahead: 5 }, 80)!.text).toBe('feature')
})

test('detached HEAD shows the sha and a badge', () => {
  expect(render({ ...BASE, branch: null }, 80)).toEqual({ text: 'HEAD@abc1234', badge: '⚠ DETACHED' })
})

test('badge priority: conflict, then rebase or merge, then detached', () => {
  expect(badgeFor({ ...BASE, conflicts: 1, op: 'merge' })).toBe('⚠ CONFLICT')
  expect(badgeFor({ ...BASE, branch: null, op: 'rebase' })).toBe('⚠ REBASE')
  expect(badgeFor({ ...BASE, op: 'merge' })).toBe('⚠ MERGE')
  expect(badgeFor({ ...BASE, branch: null })).toBe('⚠ DETACHED')
  expect(badgeFor(BASE)).toBe(null)
})

test('a long branch is shortened in the middle; counts are kept', () => {
  const s = { ...BASE, branch: 'feature/very-long-branch-name-here', dirty: 2 }
  expect(render(s, 20)!.text).toBe('feature…me-here · ±2')
})

test('the badge takes room from the branch, not the counts', () => {
  const s = { ...BASE, branch: 'feature/very-long-branch-name-here', op: 'merge' as const }
  expect(render(s, 20)).toEqual({ text: 'featur…-here', badge: '⚠ MERGE' })
})

test('a very narrow band keeps one character of branch', () => {
  const s = { ...BASE, branch: 'feature/x', dirty: 2 }
  expect(render(s, 3)!.text).toBe('… · ±2')
})

test('a non-ASCII branch that fits is shown unchanged', () => {
  expect(render({ ...BASE, branch: 'feat/ünï' }, 80)!.text).toBe('feat/ünï')
})

test('truncateMiddle', () => {
  expect(truncateMiddle('abcdef', 6)).toBe('abcdef')
  expect(truncateMiddle('abcdef', 5)).toBe('ab…ef')
  expect(truncateMiddle('abcdef', 4)).toBe('ab…f')
  expect(truncateMiddle('abcdef', 2)).toBe('a…')
  expect(truncateMiddle('abcdef', 1)).toBe('…')
  expect(truncateMiddle('abcdef', 0)).toBe('…')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test`
Expected: FAIL — `band.test.ts` cannot resolve `../hooks/band.js`.

- [ ] **Step 3: Write the implementation**

`hooks/band.js`:

```javascript
// Turns a PulseState into the band's one-row text and risk badge. Pure.

const SEP = ' · '

/**
 * @param {import('./git-state.js').PulseState} state
 * @returns {string | null}
 */
export function badgeFor(state) {
  if (state.conflicts > 0) return '⚠ CONFLICT'
  if (state.op === 'rebase') return '⚠ REBASE'
  if (state.op === 'merge') return '⚠ MERGE'
  if (state.branch === null) return '⚠ DETACHED'
  return null
}

/**
 * Shortens `s` to at most `max` characters by replacing its middle with `…`.
 * Never returns less than `…`.
 * @param {string} s
 * @param {number} max
 */
export function truncateMiddle(s, max) {
  if (s.length <= max) return s
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return s.slice(0, head) + '…' + (tail > 0 ? s.slice(-tail) : '')
}

/**
 * @param {import('./git-state.js').PulseState} state
 * @param {number} columns width the band row may use
 * @returns {{ text: string, badge: string | null } | null}
 */
export function render(state, columns) {
  if (!state.isRepo) return null

  const badge = badgeFor(state)
  const label = state.branch ?? 'HEAD@' + (state.sha ?? '?')

  const segments = []
  if (state.dirty > 0) segments.push('±' + state.dirty)
  if (state.hasUpstream) {
    const arrows = []
    if (state.ahead > 0) arrows.push('↑' + state.ahead)
    if (state.behind > 0) arrows.push('↓' + state.behind)
    if (arrows.length > 0) segments.push(arrows.join(' '))
  }
  const tail = segments.map((s) => SEP + s).join('')

  // The badge is drawn after the text with a one-column gap.
  const reserved = tail.length + (badge ? badge.length + 1 : 0)
  const room = Math.max(1, columns - reserved)
  return { text: truncateMiddle(label, room) + tail, badge }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test`
Expected: all `band.test.ts` tests pass; earlier suites still pass.

- [ ] **Step 5: Commit**

```bash
git add hooks/band.js test/band.test.ts
git commit -m "Render the band row and risk badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 5: Decide which risk toasts to show

**Files:**
- Create: `hooks/risk.js`
- Test: `test/risk.test.ts`

**Interfaces:**
- Consumes: `PulseState`, `NOT_A_REPO` from `hooks/git-state.js`.
- Produces: `diff(prev: PulseState | null, next: PulseState): string[]` — messages in order: conflict, merge, rebase, detached.

- [ ] **Step 1: Write the failing tests**

`test/risk.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'
import { NOT_A_REPO } from '../hooks/git-state.js'
import { diff } from '../hooks/risk.js'

const CLEAN = { ...NOT_A_REPO, isRepo: true, branch: 'main', sha: 'abc1234', hasUpstream: true }
const CONFLICT = { ...CLEAN, conflicts: 1, dirty: 1, op: 'merge' as const }
const REBASING = { ...CLEAN, branch: null, conflicts: 1, dirty: 1, op: 'rebase' as const }
const DETACHED = { ...CLEAN, branch: null }

test('first refresh in a clean repository: no toast', () => {
  expect(diff(null, CLEAN)).toEqual([])
})

test('first refresh mid-rebase: conflict and rebase, no detached toast', () => {
  expect(diff(null, REBASING)).toEqual(['Merge conflict in 1 file(s)', 'Rebase in progress'])
})

test('first refresh on a detached HEAD', () => {
  expect(diff(null, DETACHED)).toEqual(['Detached HEAD at abc1234'])
})

test('a merge that conflicts', () => {
  expect(diff(CLEAN, CONFLICT)).toEqual(['Merge conflict in 1 file(s)', 'Merge in progress'])
})

test('a merge in progress without conflicts', () => {
  expect(diff(CLEAN, { ...CLEAN, op: 'merge' })).toEqual(['Merge in progress'])
})

test('a state that persists does not toast again', () => {
  expect(diff(CONFLICT, CONFLICT)).toEqual([])
  expect(diff(REBASING, REBASING)).toEqual([])
  expect(diff(DETACHED, DETACHED)).toEqual([])
})

test('a changing conflict count does not toast again', () => {
  expect(diff(CONFLICT, { ...CONFLICT, conflicts: 3 })).toEqual([])
})

test('a conflict that is resolved and reappears toasts again', () => {
  const resolved = { ...CONFLICT, conflicts: 0 }
  expect(diff(CONFLICT, resolved)).toEqual([])
  expect(diff(resolved, { ...CONFLICT, conflicts: 2 })).toEqual(['Merge conflict in 2 file(s)'])
})

test('finishing a rebase back onto a branch is quiet', () => {
  expect(diff(REBASING, CLEAN)).toEqual([])
})

test('nothing outside a repository', () => {
  expect(diff(CLEAN, NOT_A_REPO)).toEqual([])
  expect(diff(null, NOT_A_REPO)).toEqual([])
})

test('moving from a non-repository into a merge counts like a first refresh', () => {
  expect(diff(NOT_A_REPO, { ...CLEAN, op: 'merge' })).toEqual(['Merge in progress'])
})

test('detached with no sha', () => {
  expect(diff(CLEAN, { ...DETACHED, sha: null })).toEqual(['Detached HEAD at unknown commit'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test`
Expected: FAIL — `risk.test.ts` cannot resolve `../hooks/risk.js`.

- [ ] **Step 3: Write the implementation**

`hooks/risk.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test`
Expected: all `risk.test.ts` tests pass; earlier suites still pass.

- [ ] **Step 5: Commit**

```bash
git add hooks/risk.js test/risk.test.ts
git commit -m "Toast only when a risky git state appears

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 6: Refresh pipeline in register.js

**Files:**
- Modify: `hooks/register.js` (replace the Task 1 stub entirely)
- Create: `test/harness.ts`
- Create: `test/refresh.test.ts`
- Delete: `test/scaffold.test.ts` (its check moves into `refresh.test.ts`)

**Interfaces:**
- Consumes: `parse`, `NOT_A_REPO`, `sameState` (Task 3); `diff` (Task 5); `fixtures` (Task 2).
- Produces (for Task 7, module-level in `register.js`): `prev: PulseState | null`, `isSlow: boolean`; and `test/harness.ts` exports:

  ```ts
  export type Scenario = string /* fixture key */ | 'not-a-repo' | 'slow' | 'missing'
  export type World = { scenario: Scenario; delayMs: number; statusCalls: number; active: number; maxActive: number; toasts: string[]; logs: string[] }
  export const START: { surface: 'terminal'; isInteractive: true; cwd: '/work' }
  export const BAND: { plugin, component: 'AbovePrompt', surface: 'terminal', viewport, props }
  export function setup(on, scenario: Scenario): { clock, world: World }
  export async function settle(clock): Promise<void>
  export async function boot($, clock): Promise<void>
  ```

- [ ] **Step 1: Write the harness**

`test/harness.ts`:

```typescript
import { mock } from 'claude-code/testing'
import { fixtures } from './fixtures.ts'

export type Scenario = string | 'not-a-repo' | 'slow' | 'missing'
export type World = {
  scenario: Scenario
  delayMs: number
  statusCalls: number
  active: number
  maxActive: number
  toasts: string[]
  logs: string[]
}

export const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

export const BAND = {
  plugin: 'repo-pulse',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 1 }, view: {} },
} as const

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
const NOT_REPO = { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
const ENOENT = { deny: 'spawn git ENOENT' }

// Registers every stub register.js needs. Call before the first use of $.
export function setup(on: any, scenario: Scenario) {
  const clock = mock.clock(on)
  const world: World = { scenario, delayMs: 0, statusCalls: 0, active: 0, maxActive: 0, toasts: [], logs: [] }

  on('session.cwd', () => ({ value: '/work' }))

  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[1] === '--version') return world.scenario === 'missing' ? ENOENT : ok('git version 2.55.0\n')
    if (world.scenario === 'missing') return ENOENT
    if (argv.includes('rev-parse')) return world.scenario === 'not-a-repo' ? NOT_REPO : ok('/work/.git\n')

    world.statusCalls += 1
    world.active += 1
    world.maxActive = Math.max(world.maxActive, world.active)
    try {
      if (world.delayMs > 0) await clock.sleep(world.delayMs)
      if (world.scenario === 'slow') return { deny: 'timed out after 5000 ms' }
      if (world.scenario === 'not-a-repo') return NOT_REPO
      return ok(fixtures[world.scenario].status)
    } finally {
      world.active -= 1
    }
  })

  on('fs.exists', ($: any, e: any) => {
    const fx = fixtures[world.scenario]
    const path: string = e.path
    if (!fx) return { value: false }
    if (path.endsWith('/MERGE_HEAD')) return { value: fx.markers.mergeHead }
    if (path.endsWith('/rebase-merge')) return { value: fx.markers.rebaseMerge }
    if (path.endsWith('/rebase-apply')) return { value: fx.markers.rebaseApply }
    return { value: false }
  })

  on('ui.toast', ($: any, e: any) => { world.toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { world.logs.push(e.text); return { value: undefined } })

  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ran' }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mod'] }))

  return { clock, world }
}

// Lets fire-and-forget refreshes finish: due timers, then a few event-loop turns.
export async function settle(clock: any) {
  await clock.settle()
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

// Starts the session and runs the first (debounced) refresh.
export async function boot($: any, clock: any) {
  await $.session.start(START)
  await clock.advance(500)
  await settle(clock)
}
```

- [ ] **Step 2: Write the failing tests**

`test/refresh.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'
import { boot, settle, setup } from './harness.ts'

test('first refresh runs 500 ms after session start', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle(clock)
  expect(world.statusCalls).toBe(0)
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(1)
})

test('tool.call results pass through unchanged', async ($, on) => {
  setup(on, 'clean')
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out).toEqual({ result: 'ran' })
})

test('a burst of tool calls makes one refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Edit', file_path: 'a.txt', old_string: 'a', new_string: 'b' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
})

test('read-only tools do not trigger a refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await $.tool.call({ tool: 'Read', file_path: 'a.txt' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before)
})

test('prompt.submit and turn.complete each schedule a refresh', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await $.prompt.submit({ text: 'hi' })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, usage: null })
  await clock.advance(500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 2)
})

test('the 30 s poll catches changes made outside Claude', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  const before = world.statusCalls
  await clock.advance(30_500)
  await settle(clock)
  expect(world.statusCalls).toBe(before + 1)
})

test('refreshes never overlap; a request during one runs once after it', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  world.delayMs = 2000
  await boot($, clock)                       // t=500: refresh 1 starts, git takes 2 s
  await $.tool.call({ tool: 'Bash', command: 'touch x' })
  await clock.advance(500)                   // t=1000: refresh 2 requested while 1 runs
  await settle(clock)
  expect(world.statusCalls).toBe(1)
  await clock.advance(2000)                  // t=3000: refresh 1 done, the rerun starts
  await settle(clock)
  expect(world.statusCalls).toBe(2)
  await clock.advance(2000)
  await settle(clock)
  expect(world.maxActive).toBe(1)
})

test('a toast fires once when a conflict appears', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  expect(world.toasts).toEqual([])
  world.scenario = 'merge_conflict'
  await $.tool.call({ tool: 'Bash', command: 'git merge side' })
  await clock.advance(500)
  await settle(clock)
  expect(world.toasts).toEqual(['Merge conflict in 1 file(s)', 'Merge in progress'])
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await clock.advance(500)
  await settle(clock)
  expect(world.toasts.length).toBe(2)
})

test('starting mid-rebase toasts once', async ($, on) => {
  const { clock, world } = setup(on, 'rebase_conflict')
  await boot($, clock)
  expect(world.toasts).toEqual(['Merge conflict in 1 file(s)', 'Rebase in progress'])
})

test('outside a repository there are no toasts and no logs', async ($, on) => {
  const { clock, world } = setup(on, 'not-a-repo')
  await boot($, clock)
  expect(world.toasts).toEqual([])
  expect(world.logs).toEqual([])
})

test('missing git logs once per session', async ($, on) => {
  const { clock, world } = setup(on, 'missing')
  await boot($, clock)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  expect(world.logs.length).toBe(1)
  expect(world.toasts).toEqual([])
})

test('slow git backs the poll off to 120 s and recovers', async ($, on) => {
  const { clock, world } = setup(on, 'clean')
  await boot($, clock)
  world.scenario = 'slow'
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  const afterSlow = world.statusCalls
  await clock.advance(60_000)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow)       // no 30 s poll while slow
  world.scenario = 'clean'
  await clock.advance(61_000)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow + 1)   // the 120 s poll, which now succeeds
  await clock.advance(30_500)
  await settle(clock)
  expect(world.statusCalls).toBe(afterSlow + 2)   // back to 30 s
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test`
Expected: FAIL — `statusCalls` stays `0` (the Task 1 stub does nothing), so most `refresh.test.ts` tests fail; `tool.call results pass through unchanged` passes.

- [ ] **Step 4: Write the implementation**

Replace `hooks/register.js` with:

```javascript
// Repo Pulse: git health in the band above the prompt.
// This is the only file that calls the mods API. It runs git, keeps the last
// state, and hands the pure modules their inputs.
import { NOT_A_REPO, parse, sameState } from './git-state.js'
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
}
```

- [ ] **Step 5: Delete the scaffold test and run the suite**

```bash
git rm -q test/scaffold.test.ts
claude plugin test
```

Expected: every test in `refresh.test.ts`, `git-state.test.ts`, `band.test.ts` and `risk.test.ts` passes.

If the timing tests fail only because work is still pending when the assertion runs, raise the loop count in `settle()` (for example to 50) before changing `register.js`. If they still fail, check whether `clock.advance` waits on timer callbacks; the callbacks here never return the refresh promise, by design.

- [ ] **Step 6: Validate**

Run: `claude plugin validate . --strict`
Expected: `✔ Validation passed`. The `hooks:` line lists `session.start`, `tool.call{tool=...}`, `prompt.submit`, `turn.complete`. The `calls:` line lists only `$.clock.after`, `$.clock.every`, `$.session.cwd`, `$.process.run`, `$.fs.exists`, `$.ui.invalidate`, `$.ui.toast`, `$.ui.log`.

- [ ] **Step 7: Commit**

```bash
git add hooks/register.js test/harness.ts test/refresh.test.ts
git commit -m "Refresh git state on edits, prompts, turns and a poll

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 7: Draw the band

**Files:**
- Modify: `hooks/register.js` (add an import and one `ui.render` hook)
- Test: `test/band-render.test.ts`

**Interfaces:**
- Consumes: `render` from `hooks/band.js` (Task 4); `prev`, `isSlow` in `register.js` (Task 6); `setup`, `boot`, `settle`, `BAND` from `test/harness.ts` (Task 6).
- Produces: the `AbovePrompt` drawing — a column `Box` whose first child is a row `Box` (`key: 'repo-pulse'`) holding a `Text` with the band text and, when present, a `Text` with the badge (`color: 'warning'`, `bold: true`); the other mods' drawing follows it.

- [ ] **Step 1: Write the failing tests**

`test/band-render.test.ts`:

```typescript
import { expect, test } from 'claude-code/testing'
import { BAND, boot, settle, setup } from './harness.ts'

test('draws branch and counts, and keeps other mods below', async ($, on) => {
  const { clock } = setup(on, 'dirty')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'main · ±3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own before the first refresh', async ($, on) => {
  setup(on, 'dirty')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own outside a repository', async ($, on) => {
  const { clock } = setup(on, 'not-a-repo')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /HEAD|main|±/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own when git is missing', async ($, on) => {
  const { clock } = setup(on, 'missing')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'repo-pulse' })).toBeUndefined()
  await ui.unmount()
})

test('shows the conflict badge in the warning colour', async ($, on) => {
  const { clock } = setup(on, 'rebase_conflict')
  await boot($, clock)
  const ui = await $.ui.mount(BAND)
  const badge = await ui.find({ type: 'Text', text: '⚠ CONFLICT' })
  expect(badge).toBeDefined()
  expect(badge!.props.color).toBe('warning')
  await ui.unmount()
})

test('dims the band while git is slow, and undims after recovery', async ($, on) => {
  const { clock, world } = setup(on, 'dirty')
  await boot($, clock)
  world.scenario = 'slow'
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(500)
  await settle(clock)
  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: 'main · ±3' }))!.props.dimColor).toBe(true)
  await ui.unmount()

  world.scenario = 'dirty'
  await clock.advance(121_000)
  await settle(clock)
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: 'main · ±3' }))!.props.dimColor).toBeUndefined()
  await ui.unmount()
})

test('a narrow band shortens the branch, not the counts', async ($, on) => {
  const { clock } = setup(on, 'ahead_behind')
  await boot($, clock)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 9 } })
  // Tail ' · ↑1 ↓2' is 8 columns, so the branch gets 1 column: '…'
  expect(await ui.find({ type: 'Text', text: '… · ↑1 ↓2' })).toBeDefined()
  await ui.unmount()
})

test('the desktop app gets the same row', async ($, on) => {
  const { clock } = setup(on, 'dirty')
  await boot($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'main · ±3' })).toBeDefined()
  await ui.unmount()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test`
Expected: FAIL — `band-render.test.ts` cannot find `main · ±3` (no `ui.render` hook yet); the "draws nothing" tests pass.

- [ ] **Step 3: Write the implementation**

In `hooks/register.js`, add the import under the existing imports:

```javascript
import { render } from './band.js'
```

Add this hook at the end of `register(on)`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test`
Expected: every suite passes.

- [ ] **Step 5: Validate**

Run: `claude plugin validate . --strict`
Expected: `✔ Validation passed`; the `hooks:` line now also lists `ui.render{component=AbovePrompt}` and `calls:` adds `$.ui.resolve`.

- [ ] **Step 6: Commit**

```bash
git add hooks/register.js test/band-render.test.ts
git commit -m "Draw the git band above the prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
```

---

### Task 8: README, CI, and the pull request

**Files:**
- Create: `README.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the finished plugin.
- Produces: a PR from `feat/v0.1` into `main` with green CI.

- [ ] **Step 1: Write the README**

`README.md`:

````markdown
# Repo Pulse

Repo Pulse is a Claude Code mod that shows your repository's git health in a
one-row band above the prompt, so you can see where you are without asking
Claude or switching terminals:

```
main · ±3 · ↑1 ↓2
```

It also shows a short toast when the repository enters a state that is easy to
miss in the middle of a session: a merge conflict, a merge in progress, a
rebase in progress, or a detached HEAD.

## What the band shows

| Part | Meaning |
|---|---|
| `main` | Current branch, or `HEAD@abc1234` when HEAD is detached |
| `±3` | Changed, staged and untracked files (hidden when 0) |
| `↑1 ↓2` | Commits ahead of and behind the upstream, as of your last fetch (hidden without an upstream) |
| `⚠ CONFLICT`, `⚠ REBASE`, `⚠ MERGE`, `⚠ DETACHED` | Risk badge |

Outside a git repository the band shows nothing.

## What it runs, and what it does not do

Repo Pulse runs these commands locally, in the session's working directory:

- `git --no-optional-locks status --porcelain=v2 --branch`
- `git rev-parse --absolute-git-dir`
- `git --version`, only when a git command fails, to tell a missing git from a slow repository

It also checks whether `MERGE_HEAD`, `rebase-merge` or `rebase-apply` exist in
the repository's git directory.

It refreshes after Claude runs Bash or edits a file, when you submit a prompt,
when a turn ends, and every 30 seconds (every 2 minutes if `git status` takes
longer than 5 seconds).

Repo Pulse makes no network requests, never runs `git fetch`, stores no data,
sends no data anywhere, and never takes git's index lock.

## Requirements

- Claude Code v2.1.287 or later (mods), tested with v2.1.287
- `git` on your `PATH`

The band draws in the Claude Code terminal and in the Code tab of the Desktop
app. In the VS Code extension's chat panel and in `claude -p`, the mod loads
but draws nothing.

## Development

```bash
claude --plugin-dir .          # load the working copy, hot-reloads on save
claude plugin test             # run the tests
claude plugin validate . --strict
test/capture-fixtures.sh       # regenerate git fixtures (needs git and jq)
```

## License

MIT
````

- [ ] **Step 2: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code@2.1.287
      - run: claude --version
      - name: Validate plugin
        run: claude plugin validate . --strict
      - name: Run tests
        run: claude plugin test
```

- [ ] **Step 3: Check locally**

```bash
claude plugin validate . --strict
claude plugin test
wc -w README.md
```

Expected: validation passes, all tests pass, README well over 40 words.

- [ ] **Step 4: Commit, push and open the PR**

```bash
git add README.md .github/workflows/ci.yml
git commit -m "Add README and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session-link>"
git push -u origin feat/v0.1
gh pr create --base main --head feat/v0.1 --title "Repo Pulse v0.1" --body "$(cat <<'EOF'
Repo Pulse v0.1: a band above the Claude Code prompt with branch, dirty count and ahead/behind, plus toasts when a merge, rebase, conflict or detached HEAD appears.

Spec: docs/superpowers/specs/2026-10-03-repo-pulse-design.md
Plan: docs/superpowers/plans/2026-10-03-repo-pulse.md

API shapes confirmed in Task 1: (fill in from Task 1 Step 3 results)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<session-link>
EOF
)"
```

Before running `gh pr create`, replace the "API shapes confirmed" line with the actual Task 1 Step 3 results.

- [ ] **Step 5: Watch CI**

```bash
gh pr checks --watch
```

Expected: `check` passes. If `claude plugin test` fails in CI with `claude plugin test: hooks modules are turned off`, read the reason it prints, report it, and do not work around it by removing the test step.

---

### Task 9: Manual smoke test in a real session (human)

**Files:** none.

This task needs an interactive terminal. The human runs it; the agent prepares the scratch repository and lists the steps.

- [ ] **Step 1: Prepare a scratch repository**

```bash
S=<scratch>/smoke
rm -rf "$S" && mkdir -p "$S" && cd "$S"
git init -q -b main && echo a > a.txt && git add . && git commit -qm one
git checkout -qb side && echo side > a.txt && git commit -qam side
git checkout -q main && echo main > a.txt && git commit -qam main
echo "cd $S && claude --plugin-dir <plugin-dir>"
```

- [ ] **Step 2: Human checks, in that session**

1. The band shows `main` within about a second of startup.
2. Ask Claude to create a file `b.txt`. The band shows `main · ±1` about a second after the edit.
3. In another terminal, run `git merge side` in the scratch repository. Within 30 s, a toast shows `Merge conflict in 1 file(s)` and `Merge in progress`, and the band shows `⚠ CONFLICT`.
4. Run `git merge --abort` in the other terminal. Within 30 s, the badge disappears and no new toast shows.
5. Run `git checkout --detach`. Within 30 s, the toast `Detached HEAD at <sha>` shows and the band shows `HEAD@<sha>` with `⚠ DETACHED`.
6. Start a session in a directory that is not a git repository: the band stays empty.

Record any difference as a bug for a follow-up task; do not change the code inside this task.
