import { describe, expect, it } from "vitest"
import { loadWorkflowConfig } from "./config.js"

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
