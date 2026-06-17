import type { WorkflowStepConfig } from "./config.js"

/**
 * Workflow arguments provided to the runtime and forwarded into every step.
 *
 * Simple JSON-compatible values are supported. Complex nested structures are
 * passed through verbatim, but the prompt renderer always prints the top-level
 * entries using JSON.stringify.
 */
export type WorkflowArgs = Record<string, unknown>

/**
 * Mandatory clarification instruction injected into every workflow step prompt.
 *
 * Tells the agent to use opencode's question tool when anything is unclear
 * before or during the step.
 */
export const CLARIFICATION_INSTRUCTION =
  "If anything is unclear before or during this step, use opencode's question tool to ask for clarification before proceeding."

/** Output produced by one previously executed workflow step. */
export interface PreviousStepOutput {
  /** Zero-based index of the step that produced this output. */
  stepIndex: number
  /** The assembled prompt sent to the step. */
  prompt: string
  /** The response text returned by the step. */
  output: string
}

/** Context required to assemble a step prompt. */
export interface BuildStepPromptInput {
  /** Name of the workflow this step belongs to. */
  workflowName: string
  /** Step configuration, including the user-authored prompt. */
  step: WorkflowStepConfig
  /** Zero-based index of this step within its workflow. */
  stepIndex: number
  /** Total number of steps in the workflow. */
  totalSteps: number
  /** Outputs from earlier steps, in execution order. */
  previousOutputs?: readonly PreviousStepOutput[]
  /** Arguments provided to the workflow by the caller. */
  args?: WorkflowArgs
}

/**
 * Format workflow arguments for inclusion in a step prompt.
 *
 * @param args - Workflow arguments from the caller.
 * @returns A deterministic string representation, or undefined when empty.
 */
function formatArgs(args: WorkflowArgs | undefined): string | undefined {
  if (args === undefined || Object.keys(args).length === 0) {
    return undefined
  }

  const lines: string[] = ["Workflow arguments:"]

  for (const [key, value] of Object.entries(args)) {
    lines.push(`- ${key}: ${JSON.stringify(value)}`)
  }

  return lines.join("\n")
}

/**
 * Build the final prompt for a single workflow step.
 *
 * Combines workflow context, previous step outputs, the user-authored step
 * prompt, and the mandatory clarification instruction into a deterministic
 * string. The user-authored prompt is preserved exactly as configured.
 *
 * @param input - Context for the step prompt.
 * @returns The assembled prompt string.
 */
export function buildStepPrompt(input: BuildStepPromptInput): string {
  const { workflowName, step, stepIndex, totalSteps, previousOutputs, args } =
    input
  const stepNumber = stepIndex + 1

  const parts: string[] = []

  parts.push(`Workflow: ${workflowName}`)
  parts.push(`Step: ${stepNumber} of ${totalSteps}`)
  parts.push("")

  const previous = previousOutputs ?? []
  if (previous.length > 0) {
    parts.push("Previous step outputs:")

    for (const entry of previous) {
      const previousStepNumber = entry.stepIndex + 1
      parts.push(`\nStep ${previousStepNumber} output:\n${entry.output}`)
    }

    parts.push("")
  }

  const argsText = formatArgs(args)
  if (argsText !== undefined) {
    parts.push(argsText)
    parts.push("")
  }

  parts.push("User-authored step prompt:")
  parts.push(step.prompt)
  parts.push("")

  parts.push("Clarification instruction:")
  parts.push(CLARIFICATION_INSTRUCTION)

  return parts.join("\n")
}
