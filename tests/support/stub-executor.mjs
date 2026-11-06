/**
 * Minimal tool executor for unit tests that only inspect step admission.
 *
 * The production composition mounts `@deepseek-ai/dsh-tool-executor-native`.
 * A test that resolves a tool set still needs an executor because the prompt
 * provider asks it to describe the admitted definitions; execution is never
 * started here.
 *
 * @returns a ToolExecutor whose `describe` projects the visible definitions.
 */
export function stubToolExecutor() {
  return {
    describe: tools => ({
      schemas: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    }),
    execute: async () => ({ results: [], additionalContexts: [], concluded: false }),
  }
}
