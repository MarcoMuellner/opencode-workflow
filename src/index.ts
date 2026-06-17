import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { OpencodeFlowOptions } from "./config.js"
import { loadWorkflowConfig, resolveWorkflowConfig } from "./config.js"
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
 * Loads named workflows from plugin tuple options and validates them
 * before any workflow step runs. Exposes a custom tool that triggers a
 * configured workflow by name.
 */
export const OpencodeFlowPlugin: Plugin = async (ctx, options) => {
  const workflowConfig: OpencodeFlowOptions = loadWorkflowConfig(options)

  return {
    tool: {
      opencode_flow: tool({
        description:
          "Run a named opencode-workflow workflow defined in the plugin options.",
        args: {
          workflowName: tool.schema.string().min(1),
          args: tool.schema.object({}).optional(),
        },
        async execute(args, context) {
          const opencodeDir = path.join(context.directory, ".opencode")
          const resolvedConfig = resolveWorkflowConfig(
            workflowConfig,
            opencodeDir
          )

          const runner = createOpencodeStepRunner(
            ctx.client as OpencodeStepRunnerClient,
            context.sessionID,
            context.directory
          )

          const result = await executeWorkflow({
            config: { workflows: resolvedConfig },
            workflowName: args.workflowName,
            runner,
            args: args.args,
          })

          return formatWorkflowResult(args.workflowName, result)
        },
      }),
    },
  }
}
