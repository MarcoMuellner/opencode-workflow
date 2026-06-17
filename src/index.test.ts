import { describe, expect, it } from "vitest"
import { OpencodeFlowPlugin } from "./index.js"

describe("OpencodeFlowPlugin", () => {
  it("is exported as a named plugin function", () => {
    // Assert
    expect(OpencodeFlowPlugin).toBeTypeOf("function")
  })

  it("returns an empty hooks object when invoked", async () => {
    // Arrange
    const input = {} as Parameters<typeof OpencodeFlowPlugin>[0]

    // Act
    const result = await OpencodeFlowPlugin(input)

    // Assert
    expect(result).toEqual({})
  })
})
