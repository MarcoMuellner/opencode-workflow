/** Configuration for a single workflow step. */
export interface WorkflowStepConfig {
  /** User-authored prompt text. Kept exactly as configured. */
  prompt: string
  /** Model identifier for this step. Free-form non-empty string in this MVP. */
  model: string
}

/** Configuration for one named workflow. */
export interface WorkflowConfig {
  /** Ordered steps to execute. */
  steps: WorkflowStepConfig[]
}

/** Plugin-specific configuration loaded from opencode config. */
export interface OpencodeFlowConfig {
  /** Named workflows keyed by workflow name. */
  workflows: Record<string, WorkflowConfig>
}

/**
 * Load and validate workflow definitions from an opencode config object.
 *
 * Throws clear, actionable errors for missing or invalid configuration
 * before any workflow step can run.
 *
 * @param config - The opencode config object, including the `opencodeFlow` key.
 * @returns A typed, normalized workflow config object.
 * @throws {Error} When the configuration is missing or invalid.
 */
export function loadWorkflowConfig(config: unknown): OpencodeFlowConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("Invalid opencode config: expected an object.")
  }

  const root = config as Record<string, unknown>

  if (!("opencodeFlow" in root)) {
    throw new Error("Missing opencodeFlow configuration.")
  }

  const opencodeFlow = root.opencodeFlow

  if (typeof opencodeFlow !== "object" || opencodeFlow === null) {
    throw new Error("Invalid opencodeFlow configuration: expected an object.")
  }

  const flow = opencodeFlow as Record<string, unknown>

  if (!("workflows" in flow)) {
    throw new Error("opencodeFlow.workflows is required.")
  }

  const workflows = flow.workflows

  if (typeof workflows !== "object" || workflows === null || Array.isArray(workflows)) {
    throw new Error("Invalid opencodeFlow.workflows: expected an object.")
  }

  const workflowEntries = Object.entries(workflows)

  if (workflowEntries.length === 0) {
    throw new Error("At least one workflow must be defined.")
  }

  const validatedWorkflows: Record<string, WorkflowConfig> = {}

  for (const [name, value] of workflowEntries) {
    const trimmedName = name.trim()

    if (trimmedName.length === 0) {
      throw new Error("Workflow name must be a non-empty string.")
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Workflow "${trimmedName}" must be an object.`)
    }

    const workflow = value as Record<string, unknown>

    for (const key of Object.keys(workflow)) {
      if (key !== "steps") {
        throw new Error(
          `Workflow "${trimmedName}" contains unknown field "${key}".`
        )
      }
    }

    if (!("steps" in workflow)) {
      throw new Error(`Workflow "${trimmedName}" has no steps array.`)
    }

    const steps = workflow.steps

    if (!Array.isArray(steps)) {
      throw new Error(`Workflow "${trimmedName}" steps must be an array.`)
    }

    if (steps.length === 0) {
      throw new Error(`Workflow "${trimmedName}" has no steps.`)
    }

    const validatedSteps: WorkflowStepConfig[] = []

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]

      if (typeof step !== "object" || step === null) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" must be an object.`
        )
      }

      const stepRecord = step as Record<string, unknown>

      for (const key of Object.keys(stepRecord)) {
        if (key !== "prompt" && key !== "model") {
          throw new Error(
            `Step ${index} in workflow "${trimmedName}" contains unknown field "${key}".`
          )
        }
      }

      if (!("prompt" in stepRecord)) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" is missing prompt.`
        )
      }

      if (typeof stepRecord.prompt !== "string") {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" prompt must be a string.`
        )
      }

      if (stepRecord.prompt.trim().length === 0) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" has an empty prompt.`
        )
      }

      if (!("model" in stepRecord)) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" is missing model.`
        )
      }

      if (typeof stepRecord.model !== "string") {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" model must be a string.`
        )
      }

      if (stepRecord.model.trim().length === 0) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" has an empty model.`
        )
      }

      validatedSteps.push({
        prompt: stepRecord.prompt,
        model: stepRecord.model,
      })
    }

    validatedWorkflows[trimmedName] = { steps: validatedSteps }
  }

  return { workflows: validatedWorkflows }
}
