# opencode-flow

An [opencode](https://opencode.ai) plugin that runs named sequential workflows from your opencode configuration.

`opencode-flow` reads workflow definitions from `opencode.json`, then executes them step by step through the opencode SDK. There is no built-in default workflow; every workflow must be configured and invoked by name.

## Install

Add the package to your opencode plugins list in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-flow"]
}
```

## Configure a workflow

Define named workflows under the `opencodeFlow` key:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-flow"],
  "opencodeFlow": {
    "workflows": {
      "review": {
        "steps": [
          {
            "prompt": "List the files changed in this branch and explain what each change does.",
            "model": "anthropic/claude-sonnet-4"
          },
          {
            "prompt": "Identify the main risks introduced by those changes.",
            "model": "anthropic/claude-sonnet-4"
          }
        ]
      }
    }
  }
}
```

## Trigger a workflow from a custom command

Create an opencode custom command that passes the workflow name to the `opencode_flow` tool. For example, `.opencode/commands/flow.md`:

```md
---
description: Run a named opencode-flow workflow
agent: build
---

Run the opencode-flow workflow named "$ARGUMENTS".

Use the `opencode_flow` tool with:
- workflowName: "$ARGUMENTS"

If "$ARGUMENTS" is empty, ask which configured workflow to run. Do not choose a default workflow.
```

Usage in the TUI:

```text
/flow review
```

`$ARGUMENTS` becomes the `workflowName` argument to the plugin tool, so any configured workflow can be triggered by name.

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
```

## Build

```bash
pnpm run build
```

This produces the compiled output in `dist/`.

