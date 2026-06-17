import type { Plugin } from "@opencode-ai/plugin"
import { loadWorkflowConfig } from "./config.js"

/**
 * opencode-flow plugin entrypoint.
 *
 * Loads named workflows from opencode configuration and validates them
 * before any workflow step runs.
 */
export const OpencodeFlowPlugin: Plugin = async () => {
  return {
    config: async (config) => {
      loadWorkflowConfig(config)
    },
  }
}
