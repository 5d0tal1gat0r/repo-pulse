# Repo Pulse — kickoff brief

Context carried over from the planning session (2026-10-03). Start a new
Claude Code session in this directory and point it at this file.

## Goal

Build a Claude Code plugin and publish it publicly in the Claude directory.

## Idea

Glanceable repo health inside Claude Code: a band or status line showing
branch, dirty files, CI state and open PR review status. A toast fires when CI
goes red.

## What is known

- Claude Code 2.1.287 is installed. `claude plugin init`, `claude plugin eval`
  and `claude plugin details` are available.
- Plugins can ship UI mods (live pane, band, status line, toast) built as
  hot-reloading function hooks. Load the `plugin-authoring` skill before
  writing one.
- Publishing: the developer portal at claude.ai/directory/manage
  (Submit new → Plugin bundle) takes a public GitHub repo. It needs a paid
  plan and a passing review. After listing, merges to the branch auto-publish.
- Verified (2026-10-03): the directory accepts mods (code named under
  `modules` in `hooks/hooks.json`) and lists them for Claude Code only.
  Mods need Claude Code v2.1.287+. Docs:
  https://code.claude.com/docs/en/plugins/mods/overview
- Directory rules that shape the design
  (https://claude.com/docs/plugins/pre-submission-checklist):
  - Plugin at the repo root; README.md of 40+ words; LICENSE file.
  - Name: kebab-case, distinctive, not taken, no reserved words alone.
  - Readable source only (no minified/compiled). Each non-image file
    under 256 KiB; 512 files max.
  - Avoid npm dependencies: a lockfile or `npx` launcher is always held
    for review. Bundle own code instead.
  - Never read env credentials like `$GITHUB_TOKEN` and send them to a
    server; ask through `userConfig` with `sensitive: true`. Relevant
    for CI / PR status calls (or shell out to the user's `gh` CLI).
  - README must disclose everything the plugin runs, sends or fetches.
- Sibling project: `../flight-recorder-plugin` (session timeline pane) is
  being designed in a separate session. Keep the two independent.
- Prior art by the same author: the Omarchy bar widget
  `~/.config/omarchy/plugins/io.github.5d0tal1gat0r.agent-watcher`.

## Process

Use superpowers brainstorming (architectural path): clarifying questions,
approaches, design, spec in `docs/superpowers/specs/`, then writing-plans.
