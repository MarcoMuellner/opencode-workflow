import type { OpencodeFlowConfig, WorkflowStepConfig } from "./config.js"
import { buildStepPrompt, type PreviousStepOutput } from "./prompt.js"

/**
 * Minimal opencode SDK client surface needed by the workflow step runner.
 *
 * This keeps the execution module independent from the full SDK package while
 * remaining compatible with the client supplied in the plugin context.
 */
export interface OpencodeStepRunnerClient {
  /** Session API subset used to prompt a session. */
  session: {
    /** Send a prompt to a session and return the created assistant message. */
    prompt: (options: {
      path: { id: string }
      query?: { directory?: string }
      body: {
        model: { providerID: string; modelID: string }
        parts: Array<{ type: "text"; text: string }>
      }
    }) => Promise<{
      data?:
        | {
            info: { error?: unknown }
            parts: Array<unknown>
          }
        | undefined
      error?: unknown | undefined
    }>
  }
}

/**
 * Input provided to a workflow step runner when executing a single step.
 */
export interface WorkflowStepRunnerInput {
  /** Name of the workflow being executed. */
  workflowName: string
  /** Step configuration from the workflow definition. */
  step: WorkflowStepConfig
  /** Zero-based index of this step within its workflow. */
  stepIndex: number
  /** Total number of steps in the workflow. */
  totalSteps: number
  /** Assembled prompt for this step, ready to send to the model. */
  prompt: string
  /** Outputs from earlier steps, in execution order. */
  previousOutputs: readonly PreviousStepOutput[]
}

/**
 * Function responsible for executing one workflow step and returning its text output.
 */
export type WorkflowStepRunner = (
  input: WorkflowStepRunnerInput
) => Promise<string>

/**
 * Split a configured model identifier into provider and model parts.
 *
 * The MVP accepts the convention `provider/model`. Single-segment strings are
 * treated as the model ID with a default provider so that runtime errors are
 * actionable when the SDK rejects them.
 *
 * @param model - Model string from workflow configuration.
 * @returns Provider and model IDs for the opencode SDK.
 * @throws {WorkflowExecutionError} When the model string is empty.
 */
function parseModelIdentifier(model: string): {
  providerID: string
  modelID: string
} {
  const trimmed = model.trim()

  if (trimmed.length === 0) {
    throw new WorkflowExecutionError("Model identifier is empty.")
  }

  const separatorIndex = trimmed.indexOf("/")

  if (separatorIndex === -1) {
    return { providerID: "default", modelID: trimmed }
  }

  const providerID = trimmed.slice(0, separatorIndex)
  const modelID = trimmed.slice(separatorIndex + 1)

  if (providerID.length === 0) {
    throw new WorkflowExecutionError(
      `Model "${model}" is missing a provider before the slash.`
    )
  }

  if (modelID.length === 0) {
    throw new WorkflowExecutionError(
      `Model "${model}" is missing a model ID after the slash.`
    )
  }

  return { providerID, modelID }
}

/**
 * Create a step runner backed by the opencode SDK client.
 *
 * Sends the assembled prompt to the provided session using the configured
 * model. Returns the concatenated assistant text parts.
 *
 * @param client - opencode SDK client from the plugin context.
 * @param sessionID - Session to send each prompt to.
 * @param directory - Optional project directory override.
 * @returns A {@link WorkflowStepRunner} for use with {@link executeWorkflow}.
 */
export function createOpencodeStepRunner(
  client: OpencodeStepRunnerClient,
  sessionID: string,
  directory?: string
): WorkflowStepRunner {
  return async (input: WorkflowStepRunnerInput): Promise<string> => {
    const { providerID, modelID } = parseModelIdentifier(input.step.model)

    const options: {
      path: { id: string }
      query?: { directory?: string }
      body: {
        model: { providerID: string; modelID: string }
        parts: Array<{ type: "text"; text: string }>
      }
    } = {
      path: { id: sessionID },
      body: {
        model: { providerID, modelID },
        parts: [{ type: "text", text: input.prompt }],
      },
    }

    if (directory !== undefined) {
      options.query = { directory }
    }

    const result = await client.session.prompt(options)

    if (result.error) {
      throw new WorkflowExecutionError(
        `SDK request failed: ${String(result.error)}`
      )
    }

    const data = result.data

    if (!data) {
      throw new WorkflowExecutionError("SDK prompt returned no data.")
    }

    if (data.info.error) {
      throw new WorkflowExecutionError(
        `Model returned an error: ${String(data.info.error)}`
      )
    }

    const textParts = data.parts.filter(
      (part: unknown): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text"
    )

    return textParts
      .map((part: { type: "text"; text: string }) => part.text)
      .join("")
  }
}

/**
 * Input for {@link executeWorkflow}.
 */
export interface ExecuteWorkflowInput {
  /** Loaded and validated workflow configuration. */
  config: OpencodeFlowConfig
  /** Name of the workflow to run. */
  workflowName: string
  /** Runner that executes a single step and returns its output. */
  runner: WorkflowStepRunner
}

/** Output produced by one executed workflow step. */
export interface WorkflowStepExecutionOutput {
  /** Zero-based index of the step that produced this output. */
  stepIndex: number
  /** The assembled prompt sent to the step. */
  prompt: string
  /** The response text returned by the step. */
  output: string
}

/**
 * Result returned by {@link executeWorkflow}.
 */
export interface WorkflowExecutionResult {
  /** Outputs produced by each executed step, in execution order. */
  outputs: WorkflowStepExecutionOutput[]
}

/**
 * Error thrown when a workflow cannot be found or when a step fails during
 * execution.
 */
export class WorkflowExecutionError extends Error {
  constructor(
    message: string,
    /**
     * Workflow that was being executed when the error occurred. Undefined when
     * the workflow itself was not found.
     */
    public readonly workflowName?: string,
    /** Step index that failed, zero-based. */
    public readonly stepIndex?: number
  ) {
    super(message)
    this.name = "WorkflowExecutionError"
  }
}

/**
 * Execute a named workflow sequentially.
 *
 * Runs each configured step in order, builds prompts that include accumulated
 * previous step outputs, and stops immediately when a step fails. A failed
 * step prevents any later steps from running.
 *
 * @param input - Workflow configuration, target workflow name, and step runner.
 * @returns The outputs produced by each executed step.
 * @throws {WorkflowExecutionError} When the workflow is unknown or a step fails.
 */
export async function executeWorkflow(
  input: ExecuteWorkflowInput
): Promise<WorkflowExecutionResult> {
  const { config, workflowName, runner } = input
  const workflow = config.workflows[workflowName]

  if (!workflow) {
    const available = Object.keys(config.workflows).join(", ")
    throw new WorkflowExecutionError(
      `Unknown workflow "${workflowName}". Available workflows: ${available}.`
    )
  }

  const totalSteps = workflow.steps.length
  const previousOutputs: WorkflowStepExecutionOutput[] = []

  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
    const step = workflow.steps[stepIndex]!
    const prompt = buildStepPrompt({
      workflowName,
      step,
      stepIndex,
      totalSteps,
      previousOutputs,
    })

    try {
      // oxlint-disable-next-line no-await-in-loop -- workflow steps are intentionally sequential
      const output = await runner({
        workflowName,
        step,
        stepIndex,
        totalSteps,
        prompt,
        previousOutputs: previousOutputs.slice(),
      })

      previousOutputs.push({ stepIndex, prompt, output })
    } catch (error) {
      const stepNumber = stepIndex + 1
      const message =
        error instanceof Error
          ? `Workflow "${workflowName}" step ${stepNumber} of ${totalSteps} failed: ${error.message}`
          : `Workflow "${workflowName}" step ${stepNumber} of ${totalSteps} failed.`

      throw new WorkflowExecutionError(message, workflowName, stepIndex)
    }
  }

  return { outputs: previousOutputs }
}
