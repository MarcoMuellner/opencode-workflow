# Workflow Config Schema

This document defines the public configuration shape for `opencode-flow`.
It is the source of truth for config loading, validation, and execution in later tasks.

## Overview

`opencode-flow` reads named workflows from the opencode configuration.
There is no built-in default workflow. Users must define at least one workflow
and trigger it explicitly by name.

In the MVP, every workflow step receives an automatic clarification instruction
that tells the agent to use opencode's question tool when clarification is needed.
The clarification policy is not configurable through this schema.

## Triggering workflows

Workflows are triggered through the plugin's `opencode_flow` custom tool.
The caller must provide the exact workflow name from `opencodeFlow.workflows`.
A common integration is an opencode custom command that forwards its argument
as the `workflowName` tool argument, for example:

```md
---
description: Run a named opencode-flow workflow
---

Run the opencode-flow workflow named "$ARGUMENTS" using the `opencode_flow` tool.
```

No workflow key is treated as a default. Calling the tool with an unknown name
fails with the list of configured workflow names.

## Top-level key

Workflow configuration lives under `opencodeFlow` in `opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-flow"],
  "opencodeFlow": {
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
}
```

## Schema definition

### `opencodeFlow`

- **Type:** `object`
- **Required.**
- Root container for this plugin's configuration.

### `opencodeFlow.workflows`

- **Type:** `object`
- **Required.**
- Keys are workflow names.
- Workflow names are non-empty strings.
- There must be at least one workflow.
- No key is treated as a default. Every workflow must be invoked by name.

### Workflow object

- **Type:** `object`
- Must contain a `steps` array.
- No other fields are allowed unless explicitly documented later.

### `steps`

- **Type:** `array`
- **Required.**
- Must contain at least one step.
- Array order is execution order.

### Step object

- **Type:** `object`
- **Required fields:**
  - `prompt`
  - `model`
- No other fields are allowed unless explicitly documented later.

#### `prompt`

- **Type:** `string`
- **Required.**
- Must be non-empty after trimming whitespace.
- The user-authored text is kept intact. The runtime will append the
  clarification instruction automatically in MVP.

#### `model`

- **Type:** `string`
- **Required.**
- Must be a non-empty string after trimming whitespace.
- The value is free-form in this schema. Runtime validation in later tasks
  decides which values are supported and how unsupported values are reported.

## Clarification policy

- The MVP always injects the same clarification instruction into every step prompt.
- The instruction tells the agent to use opencode's question tool whenever
  clarification is needed before proceeding.
- This behavior is not configurable in the schema.

## Validation intent

Invalid config must fail before any workflow step runs.
Errors should point to the problematic workflow or step.

## Valid examples

### Minimal single-step workflow

```json
{
  "opencodeFlow": {
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
}
```

### Multi-step workflow with ordered steps

```json
{
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
          },
          {
            "prompt": "Suggest concrete fixes or tests for the highest risks.",
            "model": "anthropic/claude-sonnet-4"
          }
        ]
      }
    }
  }
}
```

### Multiple named workflows

```json
{
  "opencodeFlow": {
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
}
```

## Invalid examples

These examples are invalid and must be rejected by runtime validation.
They are documented here so they can be used as test cases.

### Missing top-level config

```json
{
  "plugin": ["opencode-flow"]
}
```

Expected failure: missing `opencodeFlow` configuration.

### Missing workflows

```json
{
  "opencodeFlow": {}
}
```

Expected failure: `workflows` is required.

### Empty workflows

```json
{
  "opencodeFlow": {
    "workflows": {}
  }
}
```

Expected failure: at least one workflow must be defined.

### Implicit default workflow

```json
{
  "opencodeFlow": {
    "workflows": {
      "steps": [
        {
          "prompt": "Do something.",
          "model": "anthropic/claude-sonnet-4"
        }
      ]
    }
  }
}
```

Expected failure: `steps` is not a valid workflow name object. Workflow names
must be object keys, and there is no implicit default workflow.

### Missing steps

```json
{
  "opencodeFlow": {
    "workflows": {
      "review": {}
    }
  }
}
```

Expected failure: workflow `review` has no `steps` array.

### Empty steps

```json
{
  "opencodeFlow": {
    "workflows": {
      "review": {
        "steps": []
      }
    }
  }
}
```

Expected failure: workflow `review` has no steps.

### Missing prompt

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: step 0 in workflow `review` is missing `prompt`.

### Empty prompt

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: step 0 in workflow `review` has an empty `prompt`.

### Missing model

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: step 0 in workflow `review` is missing `model`.

### Empty model

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: step 0 in workflow `review` has an empty `model`.

### Unknown step field

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: step 0 in workflow `review` contains unknown field `temperature`.

### Unknown workflow field

```json
{
  "opencodeFlow": {
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
}
```

Expected failure: workflow `review` contains unknown field `description`.
