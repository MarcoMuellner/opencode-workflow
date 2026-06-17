/** Configuration for a single workflow step. */
export interface WorkflowStepConfig {
  /**
   * User-authored prompt text.
   *
   * May be either inline text or a path relative to the `.opencode/` directory
   * pointing to a file containing the prompt. The runtime resolves file paths
   * and uses the file contents as the prompt.
   */
  prompt: string
  /** Model identifier for this step. Free-form non-empty string in this MVP. */
  model: string
  /** Optional opencode agent to run this step with. Defaults to opencode's current/default agent. */
  agent?: string | undefined
}

/**
 * Fully resolved workflow step ready for execution.
 *
 * Prompts are always loaded inline; `promptFile` records the original file
 * path when the step configured a `.opencode/` prompt file.
 */
export interface ResolvedWorkflowStepConfig {
  /** Prompt text loaded from inline config or a `.opencode/` prompt file. */
  prompt: string
  /** Original prompt file path if the step resolved a `.opencode/` file. */
  promptFile: string | undefined
  /** Model identifier for this step. */
  model: string
  /** Optional opencode agent to run this step with. */
  agent?: string | undefined
}

/** Configuration for one named workflow after prompt files are resolved. */
export interface ResolvedWorkflowConfig {
  /** Ordered steps to execute, with inline or file-loaded prompts. */
  steps: ResolvedWorkflowStepConfig[]
}

/** Configuration for one named workflow. */
export interface WorkflowConfig {
  /** Ordered steps to execute. */
  steps: WorkflowStepConfig[]
}

/** Plugin options passed through the opencode plugin tuple. */
export interface OpencodeFlowOptions {
  /** Named workflows keyed by workflow name. */
  workflows: Record<string, WorkflowConfig>
}

/**
 * Resolve a single prompt value.
 *
 * If `prompt` looks like a `.opencode/` file path (ends with a common prompt
 * extension or references an existing file relative to `.opencode/`), read that
 * file and return its contents. Otherwise return the inline prompt text.
 *
 * @param opencodeDir - Absolute path to the `.opencode/` directory.
 * @param prompt - Prompt value from the workflow step.
 * @returns The inline prompt or file-loaded prompt, plus the source path.
 * @throws {Error} When the prompt appears to be a file path but is invalid or unreadable.
 */
export function resolvePrompt(
  opencodeDir: string,
  prompt: string
): { prompt: string; promptFile?: string } {
  const trimmed = prompt.trim()
  const lower = trimmed.toLowerCase()
  const knownExtensions = [".md", ".txt", ".prompt"]
  const looksLikeFile =
    knownExtensions.some((ext) => lower.endsWith(ext)) || !trimmed.includes(" ")

  if (!looksLikeFile) {
    return { prompt: trimmed }
  }

  const candidate = path.resolve(opencodeDir, trimmed)
  const relativeToOpencode = path.relative(opencodeDir, candidate)

  if (
    relativeToOpencode.startsWith("..") ||
    path.isAbsolute(trimmed) ||
    trimmed.startsWith("/")
  ) {
    throw new Error(
      `Prompt file path "${trimmed}" must be relative to the .opencode directory and cannot escape it.`
    )
  }

  if (!existsSync(candidate)) {
    return { prompt: trimmed }
  }

  const stats = statSync(candidate)

  if (!stats.isFile()) {
    throw new Error(
      `Prompt file path "${trimmed}" must point to a file, not a directory.`
    )
  }

  return { prompt: readFileSync(candidate, "utf-8"), promptFile: trimmed }
}

import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * Resolve every workflow in the loaded config to inline prompts.
 *
 * The source config keeps `prompt` as the raw user value. This function reads
 * `.opencode/` prompt files, rejects unsafe paths, and returns a structure that
 * execution can use directly.
 *
 * @param config - Validated config from {@link loadWorkflowConfig}.
 * @param opencodeDir - Absolute path to the `.opencode/` directory.
 * @returns A resolved copy of the config with prompt files loaded inline.
 * @throws {Error} When a prompt file path escapes `.opencode` or cannot be read.
 */
export function resolveWorkflowConfig(
  config: OpencodeFlowOptions,
  opencodeDir: string
): Record<string, ResolvedWorkflowConfig> {
  const resolved: Record<string, ResolvedWorkflowConfig> = {}

  for (const [name, workflow] of Object.entries(config.workflows)) {
    const resolvedSteps: ResolvedWorkflowStepConfig[] = []

    for (const step of workflow.steps) {
      const resolvedPrompt = resolvePrompt(opencodeDir, step.prompt)

      resolvedSteps.push({
        prompt: resolvedPrompt.prompt,
        promptFile: resolvedPrompt.promptFile,
        model: step.model,
        agent: step.agent,
      })
    }

    resolved[name] = { steps: resolvedSteps }
  }

  return resolved
}

/**
 * Load and validate workflow definitions from the plugin tuple options.
 *
 * Throws clear, actionable errors for missing or invalid configuration
 * before any workflow step can run.
 *
 * @param options - The plugin options object passed to the plugin function.
 * @returns A typed, normalized workflow config object.
 * @throws {Error} When the configuration is missing or invalid.
 */
export function loadWorkflowConfig(options: unknown): OpencodeFlowOptions {
  if (typeof options !== "object" || options === null) {
    throw new Error(
      "Invalid opencode-workflow plugin options: expected an object."
    )
  }

  const root = options as Record<string, unknown>

  if (!("workflows" in root)) {
    throw new Error("opencode-workflow plugin options require a workflows key.")
  }

  const workflows = root.workflows

  if (
    typeof workflows !== "object" ||
    workflows === null ||
    Array.isArray(workflows)
  ) {
    throw new Error("Invalid opencode-workflow workflows: expected an object.")
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
        if (key !== "prompt" && key !== "model" && key !== "agent") {
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

      if (
        "agent" in stepRecord &&
        stepRecord.agent !== undefined &&
        typeof stepRecord.agent !== "string"
      ) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" agent must be a string.`
        )
      }

      if (
        typeof stepRecord.agent === "string" &&
        stepRecord.agent.trim().length === 0
      ) {
        throw new Error(
          `Step ${index} in workflow "${trimmedName}" has an empty agent.`
        )
      }

      validatedSteps.push({
        prompt: stepRecord.prompt,
        model: stepRecord.model,
        agent:
          typeof stepRecord.agent === "string" ? stepRecord.agent : undefined,
      })
    }

    validatedWorkflows[trimmedName] = { steps: validatedSteps }
  }

  return { workflows: validatedWorkflows }
}
