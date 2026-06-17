import type { Config, PluginInput } from "@opencode-ai/plugin"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpencodeStepRunnerClient } from "./execution.js"
import { OpencodeFlowPlugin, executeWorkflow } from "./index.js"

function asConfig(value: Record<string, unknown>): Config {
  return value as Config
}

function makeValidConfig(): Config {
  return asConfig({
    opencodeFlow: {
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
    },
  })
}

function makeFakePluginInput(
  responses: string[]
): PluginInput & { capturedPrompts: unknown[] } {
  const capturedPrompts: unknown[] = []
  let callIndex = 0

  const client: OpencodeStepRunnerClient = {
    session: {
      prompt: async (options: unknown) => {
        capturedPrompts.push(options)
        const text = responses[callIndex++]

        if (text === undefined) {
          throw new Error(`No configured response for call ${callIndex}`)
        }

        return {
          data: {
            info: {},
            parts: [{ type: "text", text }],
          },
        }
      },
    },
  }

  return {
    capturedPrompts,
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

function getTool(plugin: Awaited<ReturnType<typeof OpencodeFlowPlugin>>) {
  const flowTool = plugin.tool?.opencode_flow
  expect(flowTool).toBeDefined()
  return flowTool!
}

describe("OpencodeFlowPlugin", () => {
  it("is exported as a named plugin function", () => {
    // Assert
    expect(OpencodeFlowPlugin).toBeTypeOf("function")
  })

  it("exports the workflow execution API", () => {
    // Assert
    expect(executeWorkflow).toBeTypeOf("function")
  })

  it("returns a config hook", async () => {
    // Arrange
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]

    // Act
    const result = await OpencodeFlowPlugin(input)

    // Assert
    expect(result.config).toBeTypeOf("function")
  })

  it("config hook resolves for valid opencodeFlow config", async () => {
    // Arrange
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]
    const plugin = await OpencodeFlowPlugin(input)

    // Act
    const act = async () => plugin.config?.(makeValidConfig())

    // Assert
    await expect(act()).resolves.toBeUndefined()
  })

  it("config hook rejects invalid config before any workflow runs", async () => {
    // Arrange
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]
    const plugin = await OpencodeFlowPlugin(input)
    const config = asConfig({ opencodeFlow: { workflows: {} } })

    // Act
    const act = async () => plugin.config?.(config)

    // Assert
    await expect(act()).rejects.toThrow(/At least one workflow/)
  })

  it("exposes an opencode_flow custom tool", async () => {
    // Arrange
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]
    const plugin = await OpencodeFlowPlugin(input)

    // Assert
    expect(plugin.tool).toHaveProperty("opencode_flow")
    expect(plugin.tool?.opencode_flow).toHaveProperty("execute")
  })

  it("tool runs the requested named workflow by name", async () => {
    // Arrange
    const input = makeFakePluginInput(["Summary output."])
    const plugin = await OpencodeFlowPlugin(input)
    const config = makeValidConfig()

    await plugin.config?.(config)

    // Act
    const result = await getTool(plugin).execute(
      { workflowName: "summarize" },
      makeToolContext()
    )

    // Assert
    expect(result).toContain('Completed workflow "summarize"')
    expect(result).toContain("Summary output.")
    expect(input.capturedPrompts).toHaveLength(1)
    const promptText = (
      input.capturedPrompts[0] as { body: { parts: { text: string }[] } }
    ).body.parts[0]?.text
    expect(promptText).toContain("Workflow: summarize")
    expect(promptText).not.toContain("Workflow: review")
  })

  it("tool rejects an unknown workflow name with available workflows", async () => {
    // Arrange
    const input = makeFakePluginInput([])
    const plugin = await OpencodeFlowPlugin(input)
    const config = makeValidConfig()

    await plugin.config?.(config)

    // Act
    const act = async () =>
      getTool(plugin).execute({ workflowName: "missing" }, makeToolContext())

    // Assert
    await expect(act()).rejects.toThrow(/Unknown workflow "missing"/)
    await expect(act()).rejects.toThrow(/review, summarize/)
  })

  it("tool rejects execution when config has not been loaded", async () => {
    // Arrange
    const input = makeFakePluginInput([])
    const plugin = await OpencodeFlowPlugin(input)

    // Act
    const act = async () =>
      getTool(plugin).execute({ workflowName: "summarize" }, makeToolContext())

    // Assert
    await expect(act()).rejects.toThrow(/configuration has not been loaded/)
  })

  it("loads a prompt file from .opencode and runs the workflow", async () => {
    // Arrange
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

    const plugin = await OpencodeFlowPlugin(input)
    const config = asConfig({
      opencodeFlow: {
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
      },
    })

    await plugin.config?.(config)

    const toolContext = makeToolContext()
    toolContext.directory = tempDir
    toolContext.worktree = tempDir

    // Act
    const result = await getTool(plugin).execute(
      { workflowName: "review" },
      toolContext
    )

    // Assert
    expect(result).toContain('Completed workflow "review"')
    expect(input.capturedPrompts).toHaveLength(1)
    const promptText = (
      input.capturedPrompts[0] as { body: { parts: { text: string }[] } }
    ).body.parts[0]?.text
    expect(promptText).toContain("Review the changes carefully.")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it("passes workflow args into the assembled prompt", async () => {
    // Arrange
    const input = makeFakePluginInput(["Acknowledged."])
    const plugin = await OpencodeFlowPlugin(input)
    const config = makeValidConfig()

    await plugin.config?.(config)

    // Act
    await getTool(plugin).execute(
      { workflowName: "summarize", args: { githubProjectNumber: 3 } },
      makeToolContext()
    )

    // Assert
    const promptText = (
      input.capturedPrompts[0] as { body: { parts: { text: string }[] } }
    ).body.parts[0]?.text
    expect(promptText).toContain("Workflow arguments:")
    expect(promptText).toContain("githubProjectNumber: 3")
  })

  it("rejects a prompt file path that escapes .opencode", async () => {
    // Arrange
    const tempDir = mkdtempSync(path.join(tmpdir(), "opencode-test-"))
    const input = makeFakePluginInput([])
    input.directory = tempDir
    input.worktree = tempDir

    const plugin = await OpencodeFlowPlugin(input)
    const config = asConfig({
      opencodeFlow: {
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
      },
    })

    await plugin.config?.(config)

    // Act
    const act = async () =>
      getTool(plugin).execute({ workflowName: "bad" }, makeToolContext())

    // Assert
    await expect(act()).rejects.toThrow(
      /must be relative to the .opencode directory/
    )

    rmSync(tempDir, { recursive: true, force: true })
  })
})
