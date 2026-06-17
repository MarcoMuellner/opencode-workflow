import type { PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { OpencodeStepRunnerClient } from "./execution.js"
import { OpencodeFlowPlugin, executeWorkflow } from "./index.js"

function makeValidOptions(): PluginOptions {
  return {
    workflows: {
      review: {
        steps: [
          {
            prompt: "Review the change.",
            model: "anthropic/claude-sonnet-4",
          },
        ],
      },
      summarize: {
        steps: [
          {
            prompt: "Summarize the recent changes.",
            model: "anthropic/claude-sonnet-4",
          },
        ],
      },
    },
  }
}

function makeFakePluginInput(responses: (string | Error)[]): PluginInput & {
  capturedPrompts: unknown[]
  createdSessions: {
    parentID?: string | undefined
    title?: string | undefined
  }[]
} {
  const capturedPrompts: unknown[] = []
  const createdSessions: {
    parentID?: string | undefined
    title?: string | undefined
  }[] = []
  let callIndex = 0

  const client: OpencodeStepRunnerClient = {
    session: {
      create: async (options: {
        body?: { parentID?: string; title?: string }
        query?: { directory?: string }
      }) => {
        createdSessions.push({
          parentID: options.body?.parentID,
          title: options.body?.title,
        })
        return {
          data: { id: `child-session-${createdSessions.length}` },
        }
      },
      prompt: async (options: unknown) => {
        capturedPrompts.push(options)
        const response = responses[callIndex++]

        if (response === undefined) {
          throw new Error(`No configured response for call ${callIndex}`)
        }

        if (response instanceof Error) {
          throw response
        }

        return {
          data: {
            info: {},
            parts: [{ type: "text", text: response }],
          },
        }
      },
    },
  }

  return {
    capturedPrompts,
    createdSessions,
    client: client as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/project",
    worktree: "/project",
    $: {} as PluginInput["$"],
    experimental_workspace: {
      register: () => {},
    },
    serverUrl: new URL("http://localhost"),
  }
}

function makeToolContext() {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "build",
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

function makeCapturingToolContext() {
  const captured: {
    title?: string | undefined
    metadata?: Record<string, unknown> | undefined
  }[] = []

  return {
    context: {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "build",
      directory: "/project",
      worktree: "/project",
      abort: new AbortController().signal,
      metadata: (input: {
        title?: string | undefined
        metadata?: Record<string, unknown> | undefined
      }) => captured.push({ title: input.title, metadata: input.metadata }),
      ask: async () => {},
    },
    captured,
  }
}

function getTool(plugin: Awaited<ReturnType<typeof OpencodeFlowPlugin>>) {
  const flowTool = plugin.tool?.opencode_flow
  expect(flowTool).toBeDefined()
  return flowTool!
}

describe("OpencodeFlowPlugin", () => {
  it("is exported as a named plugin function", () => {
    expect(OpencodeFlowPlugin).toBeTypeOf("function")
  })

  it("exports the workflow execution API", () => {
    expect(executeWorkflow).toBeTypeOf("function")
  })

  it("rejects missing plugin options before any workflow runs", async () => {
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]

    const act = async () => OpencodeFlowPlugin(input)

    await expect(act()).rejects.toThrow(/plugin options.*object/i)
  })

  it("rejects invalid plugin options before any workflow runs", async () => {
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]

    const act = async () => OpencodeFlowPlugin(input, { workflows: {} })

    await expect(act()).rejects.toThrow(/At least one workflow/)
  })

  it("exposes an opencode_flow custom tool", async () => {
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]

    const plugin = await OpencodeFlowPlugin(input, makeValidOptions())

    expect(plugin.tool).toHaveProperty("opencode_flow")
    expect(plugin.tool?.opencode_flow).toHaveProperty("execute")
  })

  it("tool runs the requested named workflow in a child session", async () => {
    const input = makeFakePluginInput(["Summary output."])
    const plugin = await OpencodeFlowPlugin(input, makeValidOptions())

    const toolContext = makeToolContext()
    const result = (await getTool(plugin).execute(
      { workflowName: "summarize" },
      toolContext
    )) as { output: string }

    expect(result.output).toContain('Completed workflow "summarize"')
    expect(result.output).toContain("Summary output.")
    expect(input.createdSessions).toHaveLength(1)
    expect(input.createdSessions[0]?.parentID).toBe(toolContext.sessionID)
    expect(input.createdSessions[0]?.title).toBe("workflow: summarize")
    expect(input.capturedPrompts).toHaveLength(1)
    const promptOptions = input.capturedPrompts[0] as {
      path: { id: string }
      body: { parts: { text: string }[] }
    }
    expect(promptOptions.path.id).toBe("child-session-1")
    expect(promptOptions.body.parts[0]?.text).toContain("Workflow: summarize")
    expect(promptOptions.body.parts[0]?.text).not.toContain("Workflow: review")
  })

  it("passes the per-step agent to the child session prompt", async () => {
    const input = makeFakePluginInput(["Plan output."])
    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        plan: {
          steps: [
            {
              prompt: "Plan the implementation.",
              model: "anthropic/claude-sonnet-4",
              agent: "plan",
            },
          ],
        },
      },
    })

    await getTool(plugin).execute({ workflowName: "plan" }, makeToolContext())

    const promptOptions = input.capturedPrompts[0] as {
      body: { agent?: string; parts: { text: string }[] }
    }
    expect(promptOptions.body.agent).toBe("plan")
    expect(promptOptions.body.parts[0]?.text).toContain(
      "Plan the implementation."
    )
  })

  it("tool rejects an unknown workflow name with available workflows", async () => {
    const input = makeFakePluginInput([])
    const plugin = await OpencodeFlowPlugin(input, makeValidOptions())

    const act = async () =>
      getTool(plugin).execute({ workflowName: "missing" }, makeToolContext())

    await expect(act()).rejects.toThrow(/Unknown workflow "missing"/)
    await expect(act()).rejects.toThrow(/review, summarize/)
  })

  it("loads a prompt file from .opencode and runs the workflow", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "opencode-test-"))
    const promptDir = path.join(tempDir, ".opencode", "prompts")
    mkdirSync(promptDir, { recursive: true })
    writeFileSync(
      path.join(promptDir, "review.md"),
      "Review the changes carefully.",
      "utf-8"
    )

    const input = makeFakePluginInput(["Looks good."])
    input.directory = tempDir
    input.worktree = tempDir

    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        review: {
          steps: [
            {
              prompt: "prompts/review.md",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    })

    const toolContext = makeToolContext()
    toolContext.directory = tempDir
    toolContext.worktree = tempDir

    const result = (await getTool(plugin).execute(
      { workflowName: "review" },
      toolContext
    )) as { output: string }

    expect(result.output).toContain('Completed workflow "review"')
    expect(input.capturedPrompts).toHaveLength(1)
    const promptText = (
      input.capturedPrompts[0] as { body: { parts: { text: string }[] } }
    ).body.parts[0]?.text
    expect(promptText).toContain("Review the changes carefully.")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it("passes workflow args into the assembled prompt", async () => {
    const input = makeFakePluginInput(["Acknowledged."])
    const plugin = await OpencodeFlowPlugin(input, makeValidOptions())

    await getTool(plugin).execute(
      { workflowName: "summarize", args: { githubProjectNumber: 3 } },
      makeToolContext()
    )

    const promptText = (
      input.capturedPrompts[0] as { body: { parts: { text: string }[] } }
    ).body.parts[0]?.text
    expect(promptText).toContain("Workflow arguments:")
    expect(promptText).toContain("githubProjectNumber: 3")
  })

  it("rejects a prompt file path that escapes .opencode", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "opencode-test-"))
    const input = makeFakePluginInput([])
    input.directory = tempDir
    input.worktree = tempDir

    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        bad: {
          steps: [
            {
              prompt: "../secret.md",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    })

    const act = async () =>
      getTool(plugin).execute({ workflowName: "bad" }, makeToolContext())

    await expect(act()).rejects.toThrow(
      /must be relative to the .opencode directory/
    )

    rmSync(tempDir, { recursive: true, force: true })
  })

  it("calls context.metadata while steps run and at completion", async () => {
    // Arrange
    const input = makeFakePluginInput(["First output.", "Second output."])
    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        two: {
          steps: [
            { prompt: "First.", model: "a", agent: "plan" },
            { prompt: "Second.", model: "b" },
          ],
        },
      },
    })
    const { context, captured } = makeCapturingToolContext()

    // Act
    await getTool(plugin).execute({ workflowName: "two" }, context)

    // Assert
    expect(captured.length).toBeGreaterThan(2)
    const last = captured[captured.length - 1]
    expect(last?.metadata).toMatchObject({
      workflowName: "two",
      status: "completed",
      currentStep: 2,
      totalSteps: 2,
      currentModel: "b",
      currentAgent: "default",
    })
    expect(last?.title).toMatch(/two/)
    expect(last?.title).toMatch(/2\/2/)
  })

  it("returns a structured tool result with title, output, and metadata", async () => {
    // Arrange
    const input = makeFakePluginInput(["Step result."])
    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        summarize: {
          steps: [
            {
              prompt: "Summarize the recent changes.",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    })

    // Act
    const result = await getTool(plugin).execute(
      { workflowName: "summarize" },
      makeToolContext()
    )

    // Assert
    expect(result).toEqual(
      expect.objectContaining({
        title: expect.stringContaining("summarize"),
        output: expect.stringContaining("Step result."),
        metadata: expect.objectContaining({
          workflowName: "summarize",
          status: "completed",
          totalSteps: 1,
        }),
      })
    )
  })

  it("preserves the existing final text in the structured result output", async () => {
    // Arrange
    const input = makeFakePluginInput(["Output one.", "Output two."])
    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        review: {
          steps: [
            { prompt: "First.", model: "a" },
            { prompt: "Second.", model: "b" },
          ],
        },
      },
    })

    // Act
    const result = (await getTool(plugin).execute(
      { workflowName: "review" },
      makeToolContext()
    )) as { output: string }

    // Assert
    expect(result.output).toContain('Completed workflow "review"')
    expect(result.output).toContain("Output one.")
    expect(result.output).toContain("Output two.")
  })

  it("updates metadata with failed status before rejecting on step failure", async () => {
    // Arrange
    const input = makeFakePluginInput(["ok", new Error("boom")])
    const plugin = await OpencodeFlowPlugin(input, {
      workflows: {
        review: {
          steps: [
            { prompt: "First.", model: "a" },
            { prompt: "Second.", model: "b" },
          ],
        },
      },
    })
    const { context, captured } = makeCapturingToolContext()

    // Act
    const act = async () =>
      getTool(plugin).execute({ workflowName: "review" }, context)

    // Assert
    await expect(act()).rejects.toThrow()
    const failedEntry = captured.find(
      (entry) => entry.metadata?.status === "failed"
    )
    expect(failedEntry).toBeDefined()
    expect(failedEntry?.metadata).toMatchObject({
      workflowName: "review",
      status: "failed",
      currentStep: 2,
      totalSteps: 2,
      currentModel: "b",
    })
  })
})
