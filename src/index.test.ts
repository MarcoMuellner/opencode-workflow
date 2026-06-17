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

  it("tool runs the requested named workflow by name", async () => {
    const input = makeFakePluginInput(["Summary output."])
    const plugin = await OpencodeFlowPlugin(input, makeValidOptions())

    const result = await getTool(plugin).execute(
      { workflowName: "summarize" },
      makeToolContext()
    )

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

    const result = await getTool(plugin).execute(
      { workflowName: "review" },
      toolContext
    )

    expect(result).toContain('Completed workflow "review"')
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
})
