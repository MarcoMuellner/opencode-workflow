import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadWorkflowConfig,
  resolvePrompt,
  resolveWorkflowConfig,
} from "./config.js"

function validSingleStepConfig(): Record<string, unknown> {
  return {
    opencodeFlow: {
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
    },
  }
}

describe("loadWorkflowConfig", () => {
  it("accepts a minimal single-step workflow", () => {
    // Arrange
    const config = validSingleStepConfig()

    // Act
    const result = loadWorkflowConfig(config)

    // Assert
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
    // Arrange
    const config = validSingleStepConfig()
    const loaded = loadWorkflowConfig(config)

    // Act
    const resolved = resolveWorkflowConfig(
      loaded,
      path.join(tmpdir(), "nonexistent-opencode")
    )

    // Assert
    expect(resolved.summarize?.steps[0]?.prompt).toBe(
      "Summarize the recent changes."
    )
    expect(resolved.summarize?.steps[0]?.promptFile).toBeUndefined()
  })

  it("preserves multiple workflows and step order", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [
              {
                prompt: "List changed files.",
                model: "a",
              },
              {
                prompt: "Identify risks.",
                model: "b",
              },
            ],
          },
          summarize: {
            steps: [
              {
                prompt: "Summarize.",
                model: "c",
              },
            ],
          },
        },
      },
    }

    // Act
    const result = loadWorkflowConfig(config)

    // Assert
    expect(Object.keys(result.workflows)).toEqual(["review", "summarize"])
    expect(result.workflows.review?.steps).toHaveLength(2)
    expect(result.workflows.review?.steps[0]?.prompt).toBe(
      "List changed files."
    )
    expect(result.workflows.review?.steps[1]?.prompt).toBe("Identify risks.")
  })

  it("accepts arbitrary non-empty model strings", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const result = loadWorkflowConfig(config)

    // Assert
    expect(result.workflows.custom?.steps[0]?.model).toBe(
      "my-provider/my-custom-model"
    )
  })

  it("preserves prompt text exactly", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const result = loadWorkflowConfig(config)

    // Assert
    expect(result.workflows.spaced?.steps[0]?.prompt).toBe(
      "  Keep surrounding spaces.  "
    )
  })

  it("rejects missing opencodeFlow", () => {
    // Arrange
    const config = { plugin: ["opencode-workflow"] }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/opencodeFlow/)
  })

  it("rejects missing workflows", () => {
    // Arrange
    const config = { opencodeFlow: {} }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/workflows/)
  })

  it("rejects workflows that is an array", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/opencodeFlow\.workflows.*object/)
  })

  it("rejects empty workflows", () => {
    // Arrange
    const config = { opencodeFlow: { workflows: {} } }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/At least one workflow/)
  })

  it("rejects implicit default workflow shape", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          steps: [
            {
              prompt: "Do something.",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/Workflow "steps" must be an object/)
  })

  it("rejects a workflow missing steps", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {},
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/review.*steps/)
  })

  it("rejects a workflow with empty steps", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: { steps: [] },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/review.*no steps/)
  })

  it("rejects a step missing prompt", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ model: "anthropic/claude-sonnet-4" }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review" is missing prompt/i)
  })

  it("rejects a step with empty prompt", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ prompt: "", model: "anthropic/claude-sonnet-4" }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review".*empty prompt/i)
  })

  it("rejects a step with whitespace-only prompt", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ prompt: "   ", model: "anthropic/claude-sonnet-4" }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review".*empty prompt/i)
  })

  it("rejects a step missing model", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ prompt: "Review the change." }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review" is missing model/i)
  })

  it("rejects a step with empty model", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ prompt: "Review the change.", model: "" }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review".*empty model/i)
  })

  it("rejects a step with whitespace-only model", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: [{ prompt: "Review the change.", model: "   " }],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/step 0 in workflow "review".*empty model/i)
  })

  it("rejects an unknown step field", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(
      /step 0 in workflow "review" contains unknown field "temperature"/i
    )
  })

  it("rejects an unknown workflow field", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(
      /workflow "review" contains unknown field "description"/i
    )
  })

  it("rejects an empty workflow name", () => {
    // Arrange
    const config = {
      opencodeFlow: {
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
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/Workflow name must be a non-empty string/)
  })

  it("rejects a workflow value that is not an object", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: "not an object",
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/Workflow "review" must be an object/)
  })

  it("rejects a step that is not an object", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: ["not an object"],
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
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
    // Arrange
    const prompt = "Summarize the recent changes."

    // Act
    const result = resolvePrompt(tempDir, prompt)

    // Assert
    expect(result.prompt).toBe(prompt)
    expect(result.promptFile).toBeUndefined()
  })

  it("loads a prompt file with a known extension", () => {
    // Arrange
    const promptPath = "prompts/review.md"
    const fullPath = path.join(tempDir, promptPath)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, "File prompt content.", "utf-8")

    // Act
    const result = resolvePrompt(tempDir, promptPath)

    // Assert
    expect(result.prompt).toBe("File prompt content.")
    expect(result.promptFile).toBe(promptPath)
  })

  it("loads a prompt file without spaces even without a known extension", () => {
    // Arrange
    const promptPath = "prompts/review"
    const fullPath = path.join(tempDir, promptPath)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, "No-extension file prompt.", "utf-8")

    // Act
    const result = resolvePrompt(tempDir, promptPath)

    // Assert
    expect(result.prompt).toBe("No-extension file prompt.")
    expect(result.promptFile).toBe(promptPath)
  })

  it("treats multi-word paths without known extensions as inline prompts", () => {
    // Arrange
    const prompt = "This is clearly inline text."

    // Act
    const result = resolvePrompt(tempDir, prompt)

    // Assert
    expect(result.prompt).toBe(prompt)
    expect(result.promptFile).toBeUndefined()
  })

  it("rejects absolute prompt file paths", () => {
    // Arrange
    const prompt = "/etc/passwd"

    // Act
    const act = () => resolvePrompt(tempDir, prompt)

    // Assert
    expect(act).toThrow(/must be relative to the .opencode directory/)
  })

  it("rejects paths that escape .opencode via ..", () => {
    // Arrange
    const prompt = "../secret.md"

    // Act
    const act = () => resolvePrompt(tempDir, prompt)

    // Assert
    expect(act).toThrow(/must be relative to the .opencode directory/)
  })

  it("rejects paths that resolve to a directory", () => {
    // Arrange
    const dirPath = path.join(tempDir, "prompts")
    mkdirSync(dirPath)

    // Act
    const act = () => resolvePrompt(tempDir, "prompts")

    // Assert
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
    // Arrange
    const filePromptPath = "steps/scan.md"
    const filePromptFull = path.join(tempDir, filePromptPath)
    mkdirSync(path.dirname(filePromptFull), { recursive: true })
    writeFileSync(filePromptFull, "Scan for issues.", "utf-8")

    const config = loadWorkflowConfig({
      opencodeFlow: {
        workflows: {
          review: {
            steps: [
              { prompt: "List files.", model: "a" },
              { prompt: filePromptPath, model: "b" },
            ],
          },
        },
      },
    })

    // Act
    const resolved = resolveWorkflowConfig(config, tempDir)

    // Assert
    expect(resolved.review?.steps).toHaveLength(2)
    expect(resolved.review?.steps[0]?.prompt).toBe("List files.")
    expect(resolved.review?.steps[0]?.promptFile).toBeUndefined()
    expect(resolved.review?.steps[1]?.prompt).toBe("Scan for issues.")
    expect(resolved.review?.steps[1]?.promptFile).toBe(filePromptPath)
  })
})

describe("loadWorkflowConfig", () => {
  it("rejects steps that is not an array", () => {
    // Arrange
    const config = {
      opencodeFlow: {
        workflows: {
          review: {
            steps: { not: "an array" },
          },
        },
      },
    }

    // Act
    const act = () => loadWorkflowConfig(config)

    // Assert
    expect(act).toThrow(/Workflow "review" steps must be an array/)
  })
})
