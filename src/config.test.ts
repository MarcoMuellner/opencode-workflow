import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadWorkflowConfig,
  resolvePrompt,
  resolveWorkflowConfig,
} from "./config.js"

function validSingleStepOptions(): Record<string, unknown> {
  return {
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
  }
}

describe("loadWorkflowConfig", () => {
  it("accepts a minimal single-step workflow", () => {
    const result = loadWorkflowConfig(validSingleStepOptions())

    expect(result.workflows).toHaveProperty("summarize")
    expect(result.workflows.summarize?.steps).toHaveLength(1)
    expect(result.workflows.summarize?.steps[0]?.prompt).toBe(
      "Summarize the recent changes."
    )
    expect(result.workflows.summarize?.steps[0]?.model).toBe(
      "anthropic/claude-sonnet-4"
    )
  })

  it("preserves inline prompts as-is during resolve", () => {
    const loaded = loadWorkflowConfig(validSingleStepOptions())

    const resolved = resolveWorkflowConfig(
      loaded,
      path.join(tmpdir(), "nonexistent-opencode")
    )

    expect(resolved.summarize?.steps[0]?.prompt).toBe(
      "Summarize the recent changes."
    )
    expect(resolved.summarize?.steps[0]?.promptFile).toBeUndefined()
  })

  it("preserves multiple workflows and step order", () => {
    const options = {
      workflows: {
        review: {
          steps: [
            { prompt: "List changed files.", model: "a" },
            { prompt: "Identify risks.", model: "b" },
          ],
        },
        summarize: {
          steps: [{ prompt: "Summarize.", model: "c" }],
        },
      },
    }

    const result = loadWorkflowConfig(options)

    expect(Object.keys(result.workflows)).toEqual(["review", "summarize"])
    expect(result.workflows.review?.steps).toHaveLength(2)
    expect(result.workflows.review?.steps[0]?.prompt).toBe(
      "List changed files."
    )
    expect(result.workflows.review?.steps[1]?.prompt).toBe("Identify risks.")
  })

  it("accepts arbitrary non-empty model strings", () => {
    const options = {
      workflows: {
        custom: {
          steps: [
            {
              prompt: "Use a custom model.",
              model: "my-provider/my-custom-model",
            },
          ],
        },
      },
    }

    const result = loadWorkflowConfig(options)

    expect(result.workflows.custom?.steps[0]?.model).toBe(
      "my-provider/my-custom-model"
    )
  })

  it("preserves prompt text exactly", () => {
    const options = {
      workflows: {
        spaced: {
          steps: [
            {
              prompt: "  Keep surrounding spaces.  ",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    }

    const result = loadWorkflowConfig(options)

    expect(result.workflows.spaced?.steps[0]?.prompt).toBe(
      "  Keep surrounding spaces.  "
    )
  })

  it("rejects non-object plugin options", () => {
    const act = () => loadWorkflowConfig(undefined)

    expect(act).toThrow(/plugin options.*object/i)
  })

  it("rejects missing workflows", () => {
    const act = () => loadWorkflowConfig({})

    expect(act).toThrow(/workflows/)
  })

  it("rejects workflows that is an array", () => {
    const options = {
      workflows: [
        {
          steps: [
            {
              prompt: "Review the change.",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      ],
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/workflows.*object/)
  })

  it("rejects empty workflows", () => {
    const act = () => loadWorkflowConfig({ workflows: {} })

    expect(act).toThrow(/At least one workflow/)
  })

  it("rejects implicit default workflow shape", () => {
    const options = {
      workflows: {
        steps: [
          { prompt: "Do something.", model: "anthropic/claude-sonnet-4" },
        ],
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/Workflow "steps" must be an object/)
  })

  it("rejects a workflow missing steps", () => {
    const act = () => loadWorkflowConfig({ workflows: { review: {} } })

    expect(act).toThrow(/review.*steps/)
  })

  it("rejects a workflow with empty steps", () => {
    const act = () =>
      loadWorkflowConfig({ workflows: { review: { steps: [] } } })

    expect(act).toThrow(/review.*no steps/)
  })

  it("rejects steps that is not an array", () => {
    const act = () =>
      loadWorkflowConfig({
        workflows: { review: { steps: { not: "an array" } } },
      })

    expect(act).toThrow(/Workflow "review" steps must be an array/)
  })

  it("rejects a step missing prompt", () => {
    const options = {
      workflows: {
        review: { steps: [{ model: "anthropic/claude-sonnet-4" }] },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review" is missing prompt/i)
  })

  it("rejects a step with empty prompt", () => {
    const options = {
      workflows: {
        review: { steps: [{ prompt: "", model: "anthropic/claude-sonnet-4" }] },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review".*empty prompt/i)
  })

  it("rejects a step with whitespace-only prompt", () => {
    const options = {
      workflows: {
        review: {
          steps: [{ prompt: "   ", model: "anthropic/claude-sonnet-4" }],
        },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review".*empty prompt/i)
  })

  it("rejects a step missing model", () => {
    const options = {
      workflows: {
        review: { steps: [{ prompt: "Review the change." }] },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review" is missing model/i)
  })

  it("rejects a step with empty model", () => {
    const options = {
      workflows: {
        review: { steps: [{ prompt: "Review the change.", model: "" }] },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review".*empty model/i)
  })

  it("rejects a step with whitespace-only model", () => {
    const options = {
      workflows: {
        review: { steps: [{ prompt: "Review the change.", model: "   " }] },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/step 0 in workflow "review".*empty model/i)
  })

  it("rejects an unknown step field", () => {
    const options = {
      workflows: {
        review: {
          steps: [
            {
              prompt: "Review the change.",
              model: "anthropic/claude-sonnet-4",
              temperature: 0.2,
            },
          ],
        },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(
      /step 0 in workflow "review" contains unknown field "temperature"/i
    )
  })

  it("rejects an unknown workflow field", () => {
    const options = {
      workflows: {
        review: {
          description: "A review workflow",
          steps: [
            {
              prompt: "Review the change.",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(
      /workflow "review" contains unknown field "description"/i
    )
  })

  it("rejects an empty workflow name", () => {
    const options = {
      workflows: {
        "": {
          steps: [
            {
              prompt: "Review the change.",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    }

    const act = () => loadWorkflowConfig(options)

    expect(act).toThrow(/Workflow name must be a non-empty string/)
  })

  it("rejects a workflow value that is not an object", () => {
    const act = () =>
      loadWorkflowConfig({ workflows: { review: "not an object" } })

    expect(act).toThrow(/Workflow "review" must be an object/)
  })

  it("rejects a step that is not an object", () => {
    const act = () =>
      loadWorkflowConfig({
        workflows: { review: { steps: ["not an object"] } },
      })

    expect(act).toThrow(/Step 0 in workflow "review" must be an object/)
  })
})

describe("resolvePrompt", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "opencode-test-"))
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("returns inline prompt text unchanged", () => {
    const prompt = "Summarize the recent changes."

    const result = resolvePrompt(tempDir, prompt)

    expect(result.prompt).toBe(prompt)
    expect(result.promptFile).toBeUndefined()
  })

  it("loads a prompt file with a known extension", () => {
    const promptPath = "prompts/review.md"
    const fullPath = path.join(tempDir, promptPath)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, "File prompt content.", "utf-8")

    const result = resolvePrompt(tempDir, promptPath)

    expect(result.prompt).toBe("File prompt content.")
    expect(result.promptFile).toBe(promptPath)
  })

  it("loads a prompt file without spaces even without a known extension", () => {
    const promptPath = "prompts/review"
    const fullPath = path.join(tempDir, promptPath)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, "No-extension file prompt.", "utf-8")

    const result = resolvePrompt(tempDir, promptPath)

    expect(result.prompt).toBe("No-extension file prompt.")
    expect(result.promptFile).toBe(promptPath)
  })

  it("treats multi-word paths without known extensions as inline prompts", () => {
    const prompt = "This is clearly inline text."

    const result = resolvePrompt(tempDir, prompt)

    expect(result.prompt).toBe(prompt)
    expect(result.promptFile).toBeUndefined()
  })

  it("rejects absolute prompt file paths", () => {
    const act = () => resolvePrompt(tempDir, "/etc/passwd")

    expect(act).toThrow(/must be relative to the .opencode directory/)
  })

  it("rejects paths that escape .opencode via ..", () => {
    const act = () => resolvePrompt(tempDir, "../secret.md")

    expect(act).toThrow(/must be relative to the .opencode directory/)
  })

  it("rejects paths that resolve to a directory", () => {
    const dirPath = path.join(tempDir, "prompts")
    mkdirSync(dirPath)

    const act = () => resolvePrompt(tempDir, "prompts")

    expect(act).toThrow(/must point to a file/)
  })
})

describe("resolveWorkflowConfig", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "opencode-test-"))
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("resolves a mixed inline and file-prompt workflow", () => {
    const filePromptPath = "steps/scan.md"
    const filePromptFull = path.join(tempDir, filePromptPath)
    mkdirSync(path.dirname(filePromptFull), { recursive: true })
    writeFileSync(filePromptFull, "Scan for issues.", "utf-8")

    const config = loadWorkflowConfig({
      workflows: {
        review: {
          steps: [
            { prompt: "List files.", model: "a" },
            { prompt: filePromptPath, model: "b" },
          ],
        },
      },
    })

    const resolved = resolveWorkflowConfig(config, tempDir)

    expect(resolved.review?.steps).toHaveLength(2)
    expect(resolved.review?.steps[0]?.prompt).toBe("List files.")
    expect(resolved.review?.steps[0]?.promptFile).toBeUndefined()
    expect(resolved.review?.steps[1]?.prompt).toBe("Scan for issues.")
    expect(resolved.review?.steps[1]?.promptFile).toBe(filePromptPath)
  })
})
