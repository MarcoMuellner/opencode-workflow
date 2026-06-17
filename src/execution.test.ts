import { describe, expect, it } from "vitest"
import type { WorkflowStepConfig } from "./config.js"
import {
  createOpencodeStepRunner,
  executeWorkflow,
  type OpencodeStepRunnerClient,
  type WorkflowExecutionResult,
  type WorkflowStepRunner,
  type WorkflowStepRunnerInput,
} from "./execution.js"

function makeWorkflowConfig(
  steps: { prompt: string; model: string; agent?: string }[]
) {
  return {
    workflows: {
      review: { steps },
    },
  }
}

function makeInMemoryRunner(outputs: string[]): WorkflowStepRunner {
  let callIndex = 0

  return async (input: WorkflowStepRunnerInput): Promise<string> => {
    const output = outputs[callIndex++]

    if (output === undefined) {
      throw new Error(`No configured output for call ${callIndex}`)
    }

    return output
  }
}

function makeFakeClient(
  response: {
    data?: { info: { error?: unknown }; parts: unknown[] }
    error?: unknown
  } = {
    data: { info: {}, parts: [] },
  },
  createdSessionID = "child-session-1"
): OpencodeStepRunnerClient {
  return {
    session: {
      create: async () => ({ data: { id: createdSessionID } }),
      prompt: async () => response,
    },
  }
}

describe("executeWorkflow", () => {
  it("executes a single step and returns its output", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "Review the change.", model: "anthropic/claude-sonnet-4" },
    ])
    const runner = makeInMemoryRunner(["Looks good."])

    // Act
    const result = await executeWorkflow({
      config,
      workflowName: "review",
      runner,
    })

    // Assert
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]?.output).toBe("Looks good.")
    expect(result.outputs[0]?.stepIndex).toBe(0)
    expect(result.outputs[0]?.prompt).toContain("Review the change.")
  })

  it("executes multiple steps in configured order", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "List changed files.", model: "a" },
      { prompt: "Identify risks.", model: "b" },
    ])
    const runner = makeInMemoryRunner(["src/index.ts", "No risks."])

    // Act
    const result = await executeWorkflow({
      config,
      workflowName: "review",
      runner,
    })

    // Assert
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]?.output).toBe("src/index.ts")
    expect(result.outputs[1]?.output).toBe("No risks.")
  })

  it("passes accumulated previous outputs to later steps", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "First.", model: "a" },
      { prompt: "Second.", model: "b" },
    ])
    const captured: WorkflowStepRunnerInput[] = []
    const runner = async (input: WorkflowStepRunnerInput) => {
      captured.push(input)
      return `out-${input.stepIndex}`
    }

    // Act
    await executeWorkflow({ config, workflowName: "review", runner })

    // Assert
    expect(captured[0]?.previousOutputs).toHaveLength(0)
    expect(captured[1]?.previousOutputs).toHaveLength(1)
    expect(captured[1]?.previousOutputs?.[0]?.output).toBe("out-0")
  })

  it("passes each step's configured model to the runner", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "A.", model: "provider-a/model-a" },
      { prompt: "B.", model: "provider-b/model-b" },
    ])
    const captured: WorkflowStepRunnerInput[] = []
    const runner = async (input: WorkflowStepRunnerInput) => {
      captured.push(input)
      return "ok"
    }

    // Act
    await executeWorkflow({ config, workflowName: "review", runner })

    // Assert
    expect(captured[0]?.step.model).toBe("provider-a/model-a")
    expect(captured[1]?.step.model).toBe("provider-b/model-b")
  })

  it("throws when the requested workflow does not exist", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "Review.", model: "anthropic/claude-sonnet-4" },
    ])
    const runner = makeInMemoryRunner(["ok"])

    // Act
    const act = async () =>
      executeWorkflow({ config, workflowName: "missing", runner })

    // Assert
    await expect(act()).rejects.toThrow(/missing.*workflow/i)
  })

  it("stops execution when a step fails and preserves earlier outputs", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "First.", model: "a" },
      { prompt: "Second.", model: "b" },
      { prompt: "Third.", model: "c" },
    ])
    const runner = async (input: WorkflowStepRunnerInput) => {
      if (input.stepIndex === 1) {
        throw new Error("Step failed")
      }
      return `out-${input.stepIndex}`
    }

    // Act
    const act = async () =>
      executeWorkflow({ config, workflowName: "review", runner })

    // Assert
    await expect(act()).rejects.toThrow(/step 2 of 3/i)
  })

  it("emits progress snapshots in order for a successful workflow", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "First.", model: "a" },
      { prompt: "Second.", model: "b" },
    ])
    const runner = makeInMemoryRunner(["out-0", "out-1"])
    const snapshots: import("./execution.js").WorkflowProgressSnapshot[] = []

    // Act
    await executeWorkflow({
      config,
      workflowName: "review",
      runner,
      onProgress: (snapshot) => snapshots.push(snapshot),
    })

    // Assert
    expect(snapshots).toHaveLength(6)
    expect(snapshots[0]?.status).toBe("running")
    expect(snapshots[0]?.currentStepIndex).toBe(-1)
    expect(snapshots[1]?.steps[0]?.status).toBe("running")
    expect(snapshots[2]?.steps[0]?.status).toBe("completed")
    expect(snapshots[3]?.steps[1]?.status).toBe("running")
    expect(snapshots[4]?.steps[1]?.status).toBe("completed")
    expect(snapshots[5]?.status).toBe("completed")
  })

  it("includes step model and agent in progress snapshots", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "Plan.", model: "provider-a/model-a", agent: "plan" },
      { prompt: "Build.", model: "provider-b/model-b", agent: "build" },
    ])
    const runner = makeInMemoryRunner(["out-0", "out-1"])
    const snapshots: import("./execution.js").WorkflowProgressSnapshot[] = []

    // Act
    await executeWorkflow({
      config,
      workflowName: "review",
      runner,
      onProgress: (snapshot) => snapshots.push(snapshot),
    })

    // Assert
    const lastSnapshot = snapshots[snapshots.length - 1]
    expect(lastSnapshot?.steps[0]?.model).toBe("provider-a/model-a")
    expect(lastSnapshot?.steps[0]?.agent).toBe("plan")
    expect(lastSnapshot?.steps[1]?.model).toBe("provider-b/model-b")
    expect(lastSnapshot?.steps[1]?.agent).toBe("build")
  })

  it("emits failed progress snapshot before throwing on step failure", async () => {
    // Arrange
    const config = makeWorkflowConfig([
      { prompt: "First.", model: "a" },
      { prompt: "Second.", model: "b" },
    ])
    const runner = async (input: WorkflowStepRunnerInput) => {
      if (input.stepIndex === 1) {
        throw new Error("Step failed")
      }
      return "out-0"
    }
    const snapshots: import("./execution.js").WorkflowProgressSnapshot[] = []

    // Act
    const act = async () =>
      executeWorkflow({
        config,
        workflowName: "review",
        runner,
        onProgress: (snapshot) => snapshots.push(snapshot),
      })

    // Assert
    await expect(act()).rejects.toThrow(/step 2 of 2/i)
    const lastSnapshot = snapshots[snapshots.length - 1]
    expect(lastSnapshot?.status).toBe("failed")
    expect(lastSnapshot?.steps[1]?.status).toBe("failed")
    expect(lastSnapshot?.steps[0]?.status).toBe("completed")
  })
})

describe("createOpencodeStepRunner", () => {
  it("sends a text part with the assembled prompt", async () => {
    // Arrange
    const captured: unknown[] = []
    const client: OpencodeStepRunnerClient = {
      session: {
        create: async () => ({ data: { id: "session-1" } }),
        prompt: async (options) => {
          captured.push(options)
          return { data: { info: {}, parts: [{ type: "text", text: "ok" }] } }
        },
      },
    }
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    await runner({
      workflowName: "review",
      step: { prompt: "Check this.", model: "anthropic/claude-sonnet-4" },
      stepIndex: 0,
      totalSteps: 1,
      prompt:
        "Workflow: review\nStep: 1 of 1\n\nUser-authored step prompt:\nCheck this.",
      previousOutputs: [],
      args: {},
    })

    // Assert
    expect(captured).toHaveLength(1)
    const options = captured[0] as {
      path: { id: string }
      body: { model: { providerID: string; modelID: string }; parts: unknown[] }
    }
    expect(options.path.id).toBe("session-1")
    expect(options.body.parts).toEqual([
      { type: "text", text: expect.stringContaining("Check this.") },
    ])
  })

  it("parses provider/model identifiers", async () => {
    // Arrange
    let captured: { providerID: string; modelID: string } | undefined
    const client: OpencodeStepRunnerClient = {
      session: {
        create: async () => ({ data: { id: "session-1" } }),
        prompt: async (options) => {
          captured = options.body.model
          return { data: { info: {}, parts: [{ type: "text", text: "ok" }] } }
        },
      },
    }
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    await runner({
      workflowName: "review",
      step: { prompt: "Check this.", model: "anthropic/claude-sonnet-4" },
      stepIndex: 0,
      totalSteps: 1,
      prompt: "prompt",
      previousOutputs: [],
      args: {},
    })

    // Assert
    expect(captured).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("includes the configured agent in the request body", async () => {
    // Arrange
    let capturedAgent: string | undefined
    const client: OpencodeStepRunnerClient = {
      session: {
        create: async () => ({ data: { id: "session-1" } }),
        prompt: async (options) => {
          capturedAgent = options.body.agent
          return { data: { info: {}, parts: [{ type: "text", text: "ok" }] } }
        },
      },
    }
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    await runner({
      workflowName: "review",
      step: {
        prompt: "Plan this.",
        model: "anthropic/claude-sonnet-4",
        agent: "plan",
      },
      stepIndex: 0,
      totalSteps: 1,
      prompt: "prompt",
      previousOutputs: [],
      args: {},
    })

    // Assert
    expect(capturedAgent).toBe("plan")
  })

  it("omits agent from the request body when not configured", async () => {
    // Arrange
    let capturedBody: { agent?: string } | undefined
    const client: OpencodeStepRunnerClient = {
      session: {
        create: async () => ({ data: { id: "session-1" } }),
        prompt: async (options) => {
          capturedBody = options.body
          return { data: { info: {}, parts: [{ type: "text", text: "ok" }] } }
        },
      },
    }
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    await runner({
      workflowName: "review",
      step: { prompt: "Plan this.", model: "anthropic/claude-sonnet-4" },
      stepIndex: 0,
      totalSteps: 1,
      prompt: "prompt",
      previousOutputs: [],
      args: {},
    })

    // Assert
    expect(capturedBody).not.toHaveProperty("agent")
  })

  it("concatenates multiple text parts", async () => {
    // Arrange
    const client = makeFakeClient({
      data: {
        info: {},
        parts: [
          { type: "text", text: "First." },
          { type: "text", text: "Second." },
        ],
      },
    })
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    const result = await runner({
      workflowName: "review",
      step: { prompt: "Check this.", model: "anthropic/claude-sonnet-4" },
      stepIndex: 0,
      totalSteps: 1,
      prompt: "prompt",
      previousOutputs: [],
      args: {},
    })

    // Assert
    expect(result).toBe("First.Second.")
  })

  it("throws when the SDK request fails", async () => {
    // Arrange
    const client = makeFakeClient({ error: new Error("network down") })
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    const act = async () =>
      runner({
        workflowName: "review",
        step: { prompt: "Check this.", model: "anthropic/claude-sonnet-4" },
        stepIndex: 0,
        totalSteps: 1,
        prompt: "prompt",
        previousOutputs: [],
        args: {},
      })

    // Assert
    await expect(act()).rejects.toThrow(/SDK request failed/)
  })

  it("throws when the assistant message contains an error", async () => {
    // Arrange
    const client = makeFakeClient({
      data: { info: { error: { message: "rate limit" } }, parts: [] },
    })
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    const act = async () =>
      runner({
        workflowName: "review",
        step: { prompt: "Check this.", model: "anthropic/claude-sonnet-4" },
        stepIndex: 0,
        totalSteps: 1,
        prompt: "prompt",
        previousOutputs: [],
        args: {},
      })

    // Assert
    await expect(act()).rejects.toThrow(/Model returned an error/)
  })

  it("throws for an empty model identifier", async () => {
    // Arrange
    const client = makeFakeClient()
    const runner = createOpencodeStepRunner(client, "session-1")

    // Act
    const act = async () =>
      runner({
        workflowName: "review",
        step: { prompt: "Check this.", model: "   " },
        stepIndex: 0,
        totalSteps: 1,
        prompt: "prompt",
        previousOutputs: [],
        args: {},
      })

    // Assert
    await expect(act()).rejects.toThrow(/Model identifier is empty/)
  })
})
