import type { Config } from "@opencode-ai/plugin"
import { describe, expect, it } from "vitest"
import { OpencodeFlowPlugin, executeWorkflow } from "./index.js"

function asConfig(value: Record<string, unknown>): Config {
  return value as Config
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
    const config = asConfig({
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
        },
      },
    })

    // Act
    const act = async () => plugin.config?.(config)

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
})
