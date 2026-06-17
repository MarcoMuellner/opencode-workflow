import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { OpencodeFlowOptions } from "./config.js"
import { loadWorkflowConfig, resolveWorkflowConfig } from "./config.js"
import {
  createOpencodeStepRunner,
  executeWorkflow,
  WorkflowExecutionError,
} from "./execution.js"
import type {
  OpencodeStepRunnerClient,
  WorkflowExecutionResult,
  WorkflowProgressSnapshot,
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
  WorkflowProgressCallback,
  WorkflowProgressSnapshot,
  WorkflowProgressStatus,
  WorkflowStepExecutionOutput,
  WorkflowStepProgress,
  WorkflowStepProgressStatus,
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

/** Format a progress snapshot into a concise tool card title. */
function formatWorkflowProgressTitle(
  snapshot: WorkflowProgressSnapshot
): string {
  const completed = snapshot.steps.filter(
    (step) => step.status === "completed"
  ).length
  const currentStepNumber = snapshot.currentStepIndex + 1

  if (snapshot.status === "completed") {
    return `${snapshot.workflowName} · ${completed}/${snapshot.totalSteps} completed`
  }

  if (snapshot.status === "failed") {
    return `${snapshot.workflowName} · failed at step ${currentStepNumber}/${snapshot.totalSteps}`
  }

  const stepLabel =
    snapshot.currentStepIndex < 0
      ? `starting`
      : `step ${currentStepNumber}/${snapshot.totalSteps}`

  return `${snapshot.workflowName} · ${stepLabel} running`
}

/** Build metadata for a progress snapshot suitable for context.metadata(). */
function formatWorkflowProgressMetadata(
  snapshot: WorkflowProgressSnapshot
): Record<string, unknown> {
  const currentStep = snapshot.steps[snapshot.currentStepIndex]

  return {
    workflowName: snapshot.workflowName,
    status: snapshot.status,
    currentStep: snapshot.currentStepIndex + 1,
    totalSteps: snapshot.totalSteps,
    currentModel: currentStep?.model,
    currentAgent: currentStep?.agent ?? "default",
    steps: snapshot.steps.map((step) => ({
      number: step.stepIndex + 1,
      status: step.status,
      model: step.model,
      agent: step.agent ?? "default",
    })),
  }
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

          const client = ctx.client as OpencodeStepRunnerClient
          const createOptions: {
            body: { parentID: string; title: string }
            query?: { directory?: string }
          } = {
            body: {
              parentID: context.sessionID,
              title: `workflow: ${args.workflowName}`,
            },
          }

          if (context.directory !== undefined) {
            createOptions.query = { directory: context.directory }
          }

          const createResult = await client.session.create(createOptions)

          if (createResult.error) {
            throw new WorkflowExecutionError(
              `Failed to create workflow session: ${String(createResult.error)}`
            )
          }

          if (!createResult.data) {
            throw new WorkflowExecutionError(
              "Workflow session creation returned no data."
            )
          }

          const workflowSessionID = createResult.data.id

          const runner = createOpencodeStepRunner(
            client,
            workflowSessionID,
            context.directory
          )

          let lastSnapshot: WorkflowProgressSnapshot | undefined

          const result = await executeWorkflow({
            config: { workflows: resolvedConfig },
            workflowName: args.workflowName,
            runner,
            args: args.args,
            onProgress: (snapshot) => {
              lastSnapshot = snapshot
              context.metadata({
                title: formatWorkflowProgressTitle(snapshot),
                metadata: formatWorkflowProgressMetadata(snapshot),
              })
            },
          })

          const output = formatWorkflowResult(args.workflowName, result)
          const finalSnapshot: WorkflowProgressSnapshot = lastSnapshot ?? {
            workflowName: args.workflowName,
            status: "completed",
            currentStepIndex: result.outputs.length - 1,
            totalSteps: result.outputs.length,
            steps: result.outputs.map((stepOutput) => ({
              stepIndex: stepOutput.stepIndex,
              model: "",
              agent: undefined,
              status: "completed" as const,
            })),
          }

          return {
            title: formatWorkflowProgressTitle(finalSnapshot),
            output,
            metadata: formatWorkflowProgressMetadata(finalSnapshot),
          }
        },
      }),
    },
  }
}
