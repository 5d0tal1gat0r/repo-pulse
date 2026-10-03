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
