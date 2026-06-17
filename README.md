# opencode-flow

An [opencode](https://opencode.ai) plugin that runs named sequential workflows from your opencode configuration.

> This repository is currently being scaffolded. Workflow loading, validation, and execution are planned for upcoming tasks.

## Install

Add the package to your opencode plugins list in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-flow"]
}
```

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

