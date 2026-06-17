import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { OpencodeFlowConfig } from "./config.js"
import { loadWorkflowConfig } from "./config.js"
import { createOpencodeStepRunner, executeWorkflow } from "./execution.js"
import type {
  OpencodeStepRunnerClient,
  WorkflowExecutionResult,
} from "./execution.js"

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
 * Format executed workflow outputs into a deterministic text result.
 *
 * @param workflowName - Name of the workflow that ran.
 * @param result - Execution result containing step outputs.
 * @returns Human-readable summary suitable for the tool result.
 */
function formatWorkflowResult(
  workflowName: string,
  result: WorkflowExecutionResult
): string {
  const lines: string[] = [
    `Completed workflow "${workflowName}" with ${result.outputs.length} step(s).`,
    "",
  ]

  for (const output of result.outputs) {
    const stepNumber = output.stepIndex + 1
    lines.push(`Step ${stepNumber}:`)
    lines.push(output.output)
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

/**
 * opencode-workflow plugin entrypoint.
 *
 * Loads named workflows from opencode configuration and validates them
 * before any workflow step runs. Exposes a custom tool that triggers a
 * configured workflow by name.
 */
export const OpencodeFlowPlugin: Plugin = async (ctx) => {
  let workflowConfig: OpencodeFlowConfig | undefined

  return {
    config: async (config) => {
      workflowConfig = loadWorkflowConfig(config)
    },
    tool: {
      opencode_flow: tool({
        description:
          "Run a named opencode-workflow workflow defined in the project configuration.",
        args: {
          workflowName: tool.schema.string().min(1),
        },
        async execute(args, context) {
          if (!workflowConfig) {
            throw new Error(
              "opencode-workflow configuration has not been loaded. Make sure the plugin is enabled and opencodeFlow is configured."
            )
          }

          const runner = createOpencodeStepRunner(
            ctx.client as OpencodeStepRunnerClient,
            context.sessionID,
            context.directory
          )

          const result = await executeWorkflow({
            config: workflowConfig,
            workflowName: args.workflowName,
            runner,
          })

          return formatWorkflowResult(args.workflowName, result)
        },
      }),
    },
  }
}
