// Repo Pulse: git health in the band above the prompt.
export function register(on) {
  on('tool.call', async ($, e, next) => next(e))
}
