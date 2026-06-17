import type { Plugin } from "@opencode-ai/plugin"
import { loadWorkflowConfig } from "./config.js"

export {
  createOpencodeStepRunner,
  executeWorkflow,
  WorkflowExecutionError,
} from "./execution.js"
export type {
  ExecuteWorkflowInput,
  OpencodeStepRunnerClient,
  WorkflowExecutionResult,
  WorkflowStepExecutionOutput,
  WorkflowStepRunner,
  WorkflowStepRunnerInput,
} from "./execution.js"

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
