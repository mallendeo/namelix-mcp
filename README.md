# namelix-mcp

MCP server for [namelix.com](https://namelix.com/)'s business-name generator.

## What it does

Two tools:

- **`generate_names`** — generate a fresh batch of brand ideas from keywords, with controls for style (brandable / evocative / compound / …), length, creativity, required domain availability, and TLDs.
- **`refine_names`** — iterate on a previous batch. Pass the full list of names the user has already seen plus qualitative feedback ("shorter", "less tech-bro"), and namelix diverges accordingly.

Each result includes the generated name, namelix's tagline/description, and the list of available TLDs out of the ones you asked about.

## Install

```bash
bun install
```

## Run

Two transports:

```bash
bun run src/stdio.ts    # stdio transport
bun run src/http.ts     # Streamable HTTP on port 3000 at /mcp
```

Or with scripts:

```bash
bun start        # stdio
bun start:http   # http
```

### Docker

Published image: `ghcr.io/mallendeo/namelix-mcp`.

```bash
docker run --rm -p 3000:3000 -e TRANSPORT=http ghcr.io/mallendeo/namelix-mcp:latest
docker run --rm -i ghcr.io/mallendeo/namelix-mcp:latest   # stdio
```

Build locally instead:

```bash
docker compose up http           # HTTP on localhost:3000/mcp
docker compose run --rm stdio    # interactive stdio
docker build -t namelix-mcp .    # bare build
```

The `TRANSPORT` env var (`stdio` | `http`) picks which entrypoint the image runs.

### Claude Code

Add to `~/.claude.json` (or your project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "namelix": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/namelix-mcp/src/stdio.ts"]
    }
  }
}
```

Or via CLI:

```bash
claude mcp add namelix -- bun run /absolute/path/to/namelix-mcp/src/stdio.ts
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "namelix": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/namelix-mcp/src/stdio.ts"]
    }
  }
}
```

## Configuration

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `NAMELIX_MAX_RETRIES` | `20` | Retries while namelix returns `[]` (it generates asynchronously). |
| `NAMELIX_RETRY_DELAY_MS` | `2000` | Delay between retries. |
| `NAMELIX_USER_AGENT` | desktop Safari | Override the User-Agent sent to namelix. |

## Development

```bash
bun test            # unit tests (mocked fetch, no network)
bun run test/live.ts # live smoke test against namelix (takes ~5-10s)
bun x tsc --noEmit  # typecheck
```
