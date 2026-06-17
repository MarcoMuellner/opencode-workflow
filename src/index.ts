import type { Plugin } from "@opencode-ai/plugin"

/**
 * opencode-flow plugin entrypoint.
 *
 * Currently returns an empty hooks object. Workflow loading, validation,
 * and execution will be added in later tasks.
 */
export const OpencodeFlowPlugin: Plugin = async () => {
  return {}
}
