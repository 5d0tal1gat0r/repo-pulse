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

The band draws in the Claude Code terminal. Claude Code raises the band above
the prompt only in the terminal, so in the Desktop app, the VS Code extension's
chat panel and `claude -p` the mod loads but draws nothing. The band steps
aside while Claude Code shows its feedback survey.

## Development

```bash
claude --plugin-dir .          # load the working copy, hot-reloads on save
claude plugin test             # run the tests
claude plugin validate . --strict
test/capture-fixtures.sh       # regenerate git fixtures (needs git and jq)
```

## License

MIT
