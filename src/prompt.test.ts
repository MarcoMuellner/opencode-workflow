import { describe, expect, it } from "vitest"
import { buildStepPrompt, CLARIFICATION_INSTRUCTION } from "./prompt.js"

function makeStep(prompt: string, model: string) {
  return { prompt, model }
}

describe("buildStepPrompt", () => {
  it("includes the user prompt and the clarification instruction", () => {
    // Arrange
    const step = makeStep("Summarize the recent changes.", "anthropic/claude-sonnet-4")

    // Act
    const result = buildStepPrompt({
      workflowName: "summarize",
      step,
      stepIndex: 0,
      totalSteps: 1,
    })

    // Assert
    expect(result).toContain("Summarize the recent changes.")
    expect(result).toContain(CLARIFICATION_INSTRUCTION)
  })

  it("includes workflow context for the step", () => {
    // Arrange
    const step = makeStep("Review the change.", "anthropic/claude-sonnet-4")

    // Act
    const result = buildStepPrompt({
      workflowName: "review",
      step,
      stepIndex: 0,
      totalSteps: 3,
    })

    // Assert
    expect(result).toContain("Workflow: review")
    expect(result).toContain("Step: 1 of 3")
  })

  it("omits previous outputs for the first step", () => {
    // Arrange
    const step = makeStep("List changed files.", "anthropic/claude-sonnet-4")

    // Act
    const result = buildStepPrompt({
      workflowName: "review",
      step,
      stepIndex: 0,
      totalSteps: 2,
    })

    // Assert
    expect(result).not.toContain("Previous step outputs:")
    expect(result).toContain("List changed files.")
  })

  it("includes previous step outputs for later steps in order", () => {
    // Arrange
    const step = makeStep("Identify risks.", "anthropic/claude-sonnet-4")
    const previousOutputs = [
      { stepIndex: 0, prompt: "List changed files.", output: "Changed src/index.ts." },
    ]

    // Act
    const result = buildStepPrompt({
      workflowName: "review",
      step,
      stepIndex: 1,
      totalSteps: 2,
      previousOutputs,
    })

    // Assert
    expect(result).toContain("Previous step outputs:")
    expect(result).toContain("Step 1 output:")
    expect(result).toContain("Changed src/index.ts.")
    expect(result.indexOf("Previous step outputs:")).toBeLessThan(
      result.indexOf("User-authored step prompt:")
    )
    expect(result.indexOf("User-authored step prompt:")).toBeLessThan(
      result.indexOf("Clarification instruction:")
    )
  })

  it("preserves user-authored prompt text exactly", () => {
    // Arrange
    const step = makeStep("  Keep surrounding spaces.  \n\nAnd newlines.", "anthropic/claude-sonnet-4")

    // Act
    const result = buildStepPrompt({
      workflowName: "spaced",
      step,
      stepIndex: 0,
      totalSteps: 1,
    })

    // Assert
    expect(result).toContain("  Keep surrounding spaces.  \n\nAnd newlines.")
  })

  it("produces the same output for the same input", () => {
    // Arrange
    const step = makeStep("Summarize.", "anthropic/claude-sonnet-4")
    const input = {
      workflowName: "summarize",
      step,
      stepIndex: 0,
      totalSteps: 1,
    }

    // Act
    const first = buildStepPrompt(input)
    const second = buildStepPrompt(input)

    // Assert
    expect(first).toBe(second)
  })

  it("includes multiple previous outputs in execution order", () => {
    // Arrange
    const step = makeStep("Suggest fixes.", "anthropic/claude-sonnet-4")
    const previousOutputs = [
      { stepIndex: 0, prompt: "List files.", output: "File A" },
      { stepIndex: 1, prompt: "Identify risks.", output: "Risk B" },
    ]

    // Act
    const result = buildStepPrompt({
      workflowName: "review",
      step,
      stepIndex: 2,
      totalSteps: 3,
      previousOutputs,
    })

    // Assert
    const firstOutputIndex = result.indexOf("File A")
    const secondOutputIndex = result.indexOf("Risk B")
    expect(firstOutputIndex).toBeLessThan(secondOutputIndex)
  })
})
