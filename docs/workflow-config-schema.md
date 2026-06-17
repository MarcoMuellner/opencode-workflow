# Workflow Config Schema

This document defines the public configuration shape for `opencode-workflow`.
It is the source of truth for config loading, validation, and execution.

## Overview

`opencode-workflow` reads named workflows from the plugin tuple options in
`opencode.json`. There is no built-in default workflow. Users must define at
least one workflow and trigger it explicitly by name.

Every workflow step receives an automatic clarification instruction that tells
the agent to use opencode's question tool when clarification is needed. The
clarification policy is not configurable through this schema.

## Triggering workflows

Workflows are triggered through the plugin's `opencode_flow` custom tool. The
caller must provide the exact workflow name from the plugin options `workflows`
object.

Example custom command:

```md
---
description: Run a named opencode-workflow workflow
---

Run the opencode-workflow workflow named "$ARGUMENTS" using the `opencode_flow` tool.
```

No workflow key is treated as a default. Calling the tool with an unknown name
fails with the list of configured workflow names.

### Tool Arguments

The `opencode_flow` tool accepts:

- `workflowName` (string, required): the workflow to run.
- `args` (object, optional): structured arguments forwarded into every step prompt. Each top-level entry is rendered with its JSON value in the prompt.

Example:

```json
{
  "workflowName": "plan",
  "args": {
    "githubProjectNumber": 3
  }
}
```

Inside every step prompt this becomes:

```text
Workflow arguments:
- githubProjectNumber: 3
```

## Plugin Options

Workflow configuration lives in the second item of the `plugin` tuple in
`opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-workflow",
      {
        "workflows": {
          "review": {
            "steps": [
              {
                "prompt": "Review the change for correctness and risks.",
                "model": "anthropic/claude-sonnet-4"
              }
            ]
          }
        }
      }
    ]
  ]
}
```

Do not use a custom top-level key such as `opencodeFlow`; opencode rejects
unknown top-level config keys before plugins can load.

## Schema Definition

### `workflows`

- **Type:** `object`
- **Required.**
- Keys are workflow names.
- Workflow names are non-empty strings.
- There must be at least one workflow.
- No key is treated as a default. Every workflow must be invoked by name.

### Workflow Object

- **Type:** `object`
- Must contain a `steps` array.
- No other fields are allowed unless explicitly documented later.

### `steps`

- **Type:** `array`
- **Required.**
- Must contain at least one step.
- Array order is execution order.

### Step Object

- **Type:** `object`
- **Required fields:** `prompt`, `model`
- **Optional fields:** `agent`
- No other fields are allowed unless explicitly documented later.

#### `prompt`

- **Type:** `string`
- **Required.**
- Must be non-empty after trimming whitespace.
- The user-authored text is kept intact. The runtime appends the clarification instruction automatically.
- If the value looks like a file path (no spaces, or ends in `.md`, `.txt`, or `.prompt`), the runtime attempts to read it relative to the `.opencode/` directory.
- Prompt file paths must be relative to `.opencode/` and cannot use `..` or absolute paths to escape it.

#### `model`

- **Type:** `string`
- **Required.**
- Must be a non-empty string after trimming whitespace.
- The value is free-form in this schema. Runtime validation decides which values are supported and how unsupported values are reported.

#### `agent`

- **Type:** `string`
- **Optional.**
- Must be a non-empty string after trimming whitespace when present.
- When provided, the workflow step runs with the named opencode agent. When omitted, the step runs with opencode's current/default agent.

## Validation Intent

Invalid config must fail before any workflow step runs. Errors should point to
the problematic workflow or step.

## Valid Examples

### Minimal Single-Step Workflow

```json
{
  "workflows": {
    "summarize": {
      "steps": [
        {
          "prompt": "Summarize the recent changes in plain language.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

### Multi-Step Workflow With Ordered Steps

```json
{
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
        },
        {
          "prompt": "Suggest concrete fixes or tests for the highest risks.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

### Multi-Step Workflow With Per-Step Agents

```json
{
  "workflows": {
    "plan-and-build": {
      "steps": [
        {
          "prompt": "Plan the implementation for the selected task.",
          "model": "anthropic/claude-sonnet-4",
          "agent": "plan"
        },
        {
          "prompt": "Implement the plan produced above. Follow the plan exactly.",
          "model": "anthropic/claude-sonnet-4",
          "agent": "build"
        }
      ]
    }
  }
}
```

### Multiple Named Workflows

```json
{
  "workflows": {
    "summarize": {
      "steps": [
        {
          "prompt": "Summarize the recent changes.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    },
    "review": {
      "steps": [
        {
          "prompt": "Review the change for correctness and risks.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

## Invalid Examples

These examples are invalid and must be rejected by runtime validation.

### Missing Plugin Options

```json
undefined
```

Expected failure: plugin options must be an object.

### Missing Workflows

```json
{}
```

Expected failure: `workflows` is required.

### Empty Workflows

```json
{
  "workflows": {}
}
```

Expected failure: at least one workflow must be defined.

### Implicit Default Workflow

```json
{
  "workflows": {
    "steps": [
      {
        "prompt": "Do something.",
        "model": "anthropic/claude-sonnet-4"
      }
    ]
  }
}
```

Expected failure: `steps` is not a valid workflow object. Workflow names must be
object keys, and there is no implicit default workflow.

### Missing Steps

```json
{
  "workflows": {
    "review": {}
  }
}
```

Expected failure: workflow `review` has no `steps` array.

### Empty Steps

```json
{
  "workflows": {
    "review": {
      "steps": []
    }
  }
}
```

Expected failure: workflow `review` has no steps.

### Missing Prompt

```json
{
  "workflows": {
    "review": {
      "steps": [
        {
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

Expected failure: step 0 in workflow `review` is missing `prompt`.

### Empty Prompt

```json
{
  "workflows": {
    "review": {
      "steps": [
        {
          "prompt": "",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

Expected failure: step 0 in workflow `review` has an empty `prompt`.

### Missing Model

```json
{
  "workflows": {
    "review": {
      "steps": [
        {
          "prompt": "Review the change."
        }
      ]
    }
  }
}
```

Expected failure: step 0 in workflow `review` is missing `model`.

### Empty Model

```json
{
  "workflows": {
    "review": {
      "steps": [
        {
          "prompt": "Review the change.",
          "model": ""
        }
      ]
    }
  }
}
```

Expected failure: step 0 in workflow `review` has an empty `model`.

### Unknown Step Field

```json
{
  "workflows": {
    "review": {
      "steps": [
        {
          "prompt": "Review the change.",
          "model": "anthropic/claude-sonnet-4",
          "temperature": 0.2
        }
      ]
    }
  }
}
```

Expected failure: step 0 in workflow `review` contains unknown field
`temperature`.

### Unknown Workflow Field

```json
{
  "workflows": {
    "review": {
      "description": "A review workflow",
      "steps": [
        {
          "prompt": "Review the change.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

Expected failure: workflow `review` contains unknown field `description`.
