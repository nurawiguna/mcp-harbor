# MCP Harbor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)

> **This is a fork** of [nomagicln/mcp-harbor](https://github.com/nomagicln/mcp-harbor), the original MCP server for Harbor.
> It has been extended with additional configuration options and security hardening around the SSE transport
> (see [What's Different From the Original](#whats-different-from-the-original)). All credit for the original
> implementation goes to the upstream author; see [LICENSE](LICENSE) for the MIT license and copyright notice.

MCP Harbor is a Node.js application that provides a Model Context Protocol (MCP) server for interacting with Harbor container registry.

## Table of Contents

- [MCP Harbor](#mcp-harbor)
  - [Table of Contents](#table-of-contents)
  - [What's Different From the Original](#whats-different-from-the-original)
  - [Features](#features)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Usage](#usage)
    - [Transport Modes](#transport-modes)
    - [Command Line Arguments](#command-line-arguments)
    - [Environment Variables](#environment-variables)
    - [Securing the SSE Transport](#securing-the-sse-transport)
    - [Connecting to the SSE Endpoint](#connecting-to-the-sse-endpoint)
    - [Running in Production](#running-in-production)
    - [Using It From an MCP Client (e.g. Claude Desktop)](#using-it-from-an-mcp-client-eg-claude-desktop)
  - [MCP Tools](#mcp-tools)
  - [Development](#development)
    - [Running in Development Mode](#running-in-development-mode)
    - [Running Tests](#running-tests)
  - [Project Structure](#project-structure)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
    - [Debug Mode](#debug-mode)
    - [Support](#support)
  - [License](#license)

## What's Different From the Original

This fork keeps all the original Harbor MCP tools and behavior, and adds:

- **TLS verification is secure by default**: the original disabled TLS certificate validation for the whole
  process unconditionally. It is now opt-in via `--insecure-tls` / `HARBOR_INSECURE_TLS`, only relevant when
  `HARBOR_URL` uses `https://` with a self-signed/internal certificate.
- **Configurable SSE bind address**: the SSE server used to always bind `0.0.0.0` (all network interfaces).
  It now defaults to `127.0.0.1` and is configurable via `--sse-host` / `HARBOR_SSE_HOST`.
- **Bearer token authentication for SSE**: `/sse` and `/messages` can now require an
  `Authorization: Bearer <token>` header via `--sse-auth-token` / `HARBOR_SSE_AUTH_TOKEN`, since the SSE
  transport otherwise has no authentication of its own.
- **Correct multi-client SSE sessions**: SSE connections are now tracked per session instead of a single
  shared/global connection, so concurrent clients no longer risk having their messages cross-routed.

## Features

- **MCP Server**: Exposes tools for interacting with Harbor through the Model Context Protocol
- **Harbor Operations**: Supports operations for projects, repositories, tags, and Helm charts
- **TypeScript**: Written in TypeScript for better type safety and developer experience
- **Automated Tests**: Comprehensive test suite for reliable functionality

## Prerequisites

Before installing MCP Harbor, ensure you have:

- Node.js 18.x or higher
- npm 8.x or higher
- Access to a Harbor registry instance
- Git (for cloning the repository)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/nurawiguna/mcp-harbor.git
   ```

2. Navigate to the project directory:

   ```bash
   cd mcp-harbor
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Build the project:

   ```bash
   npm run build
   ```

## Usage

### Transport Modes

MCP Harbor supports two transport modes:

- **stdio** (default): the MCP client (e.g. Claude Desktop, Cursor) spawns `mcp-harbor` directly as a
  subprocess and communicates over stdin/stdout. No network port is opened at all, so no SSE-related
  configuration is needed. Use this when the client and `mcp-harbor` run on the same machine.
- **SSE** (`--sse`, or `HARBOR_SSE=true` in `.env`): runs an HTTP server so MCP clients on a different
  machine/process can connect over the network. This must be explicitly turned on — plain `npm start` /
  `node dist/app.js` with no flags always runs stdio mode, even if `HARBOR_SSE_HOST`/`HARBOR_SSE_AUTH_TOKEN`
  are set. Because enabling it opens a network port, see [Securing the SSE Transport](#securing-the-sse-transport)
  below before enabling it.

### Command Line Arguments

The application accepts the following command line arguments:

```bash
Options:
  --url            Harbor API URL (the remote Harbor server mcp-harbor
                    connects to)                        [string] [required]
  --username       Harbor username                      [string] [required]
  --password       Harbor password                      [string] [required]
  --insecure-tls   Disable TLS certificate verification when connecting to
                    the Harbor URL over HTTPS. Only for trusted internal
                    networks with a self-signed certificate.
                                                 [boolean] [default: false]
  --debug          Enable debug mode                [boolean] [default: false]
  --sse            Enable SSE transport               [boolean] [default: false]
  --port           Port for the local SSE server to listen on
                                                      [number] [default: 3000]
  --sse-host       Host/interface the local SSE server binds to (this
                    machine, not the Harbor server)
                                                 [string] [default: "127.0.0.1"]
  --sse-auth-token Bearer token required to authenticate SSE connections to
                    this MCP server                                 [string]
  --help           Show help                                       [boolean]
```

### Environment Variables

Instead of command line arguments, you can also use environment variables. Create a `.env` file in the root directory (see [.env.example](.env.example)):

```env
# Harbor API Configuration
# HARBOR_URL is the remote Harbor server this app connects OUT to.
# Works with either http:// or https:// (matches the Harbor server's own setup).
HARBOR_URL=https://harbor.example.com
HARBOR_USERNAME=admin
HARBOR_PASSWORD=Harbor12345

# Only set this to true if HARBOR_URL is https:// with a self-signed/internal
# certificate. Leave it false (default) whenever the certificate is trusted,
# or when HARBOR_URL is http:// (in which case it has no effect anyway).
HARBOR_INSECURE_TLS=false

# Debug Mode (true/false)
DEBUG=false

# --- Local SSE server ---
# These configure mcp-harbor's OWN inbound server, i.e. where MCP clients
# (Claude, Cursor, etc.) connect TO this app. Unrelated to HARBOR_URL above.

# Enables SSE mode (equivalent to the --sse flag). Without this set to true
# (in either this file or the actual environment) and without --sse passed on
# the command line, mcp-harbor runs in stdio mode instead and never opens a
# port at all - "npm start" alone does NOT turn SSE on by itself.
HARBOR_SSE=true

# Host/interface this app listens on (only relevant when SSE is enabled above).
# Keep 127.0.0.1 unless this server sits behind a trusted reverse proxy/firewall
# that restricts who can reach it.
HARBOR_SSE_HOST=127.0.0.1
# Bearer token required on the Authorization header for /sse and /messages.
# Required in practice whenever HARBOR_SSE_HOST is anything other than 127.0.0.1.
HARBOR_SSE_AUTH_TOKEN=change-me-to-a-long-random-value
```

### Securing the SSE Transport

The SSE transport has no authentication of its own, so treat these as required whenever `mcp-harbor` is
reachable by more than just your own machine:

1. Keep `HARBOR_SSE_HOST` at `127.0.0.1` unless a client genuinely needs to connect from another host.
2. If it must be reachable from other hosts, set a long random `HARBOR_SSE_AUTH_TOKEN`
   (e.g. `openssl rand -hex 32`) and put a firewall rule in front of the port restricting which hosts can
   reach it.
3. Prefer a trusted reverse proxy with TLS termination in front of the SSE port if it is exposed beyond
   `localhost`, since the SSE server itself speaks plain HTTP.

### Connecting to the SSE Endpoint

When `--sse` is enabled, the URL an MCP client connects to is:

```
http://<host>:<port>/sse
```

- `<host>` / `<port>` are whatever `HARBOR_SSE_HOST` / `--port` are set to (default `127.0.0.1:3000`).
- `/messages` is a **separate, internal** endpoint the server tells the client about after the `/sse`
  connection is established (it includes a `sessionId` query parameter). MCP client libraries handle this
  handshake automatically — you only ever configure the `/sse` URL, never `/messages` directly.

Examples for `HARBOR_SSE_HOST=0.0.0.0`, default port:

| Where the client runs | URL to use |
|---|---|
| Same machine as `mcp-harbor` | `http://127.0.0.1:3000/sse` |
| A different machine on the network | `http://<mcp-harbor-host-ip>:3000/sse` |

If `HARBOR_SSE_AUTH_TOKEN` is set, the client must send it as a bearer token on every request to `/sse`
(and `/messages`). For an MCP client config that supports a remote/URL-based server entry, this typically
looks like:

```json
{
  "mcpServers": {
    "harbor": {
      "url": "http://<mcp-harbor-host-ip>:3000/sse",
      "headers": {
        "Authorization": "Bearer <your HARBOR_SSE_AUTH_TOKEN>"
      }
    }
  }
}
```

The exact field names (`url`, `headers`, etc.) vary by MCP client — check that client's docs for how it
configures a remote/SSE MCP server.

### Running in Production

Build once, then run the compiled output directly — no TypeScript tooling needed at runtime:

```bash
npm run build
npm start -- --url https://harbor.example.com --username admin --password ***
# or, with a .env file in place (see Environment Variables above):
npm start
```

`npm start` just runs `node dist/app.js`; any flags after `--` are forwarded to it. You can also invoke
`node dist/app.js` directly, or install it as a global command:

```bash
npm install -g .
mcp-harbor --url https://harbor.example.com --username admin --password ***
```

> **`npm start` on its own does NOT enable SSE mode.** It runs in stdio mode by default (no port opened at
> all), regardless of `HARBOR_SSE_HOST`/`HARBOR_SSE_AUTH_TOKEN` being set — those only configure SSE, they
> don't turn it on. If you hit `/sse` and get a connection error or 404, this is almost always why. To
> actually enable SSE, either:
>
> ```bash
> npm start -- --sse
> ```
>
> or set `HARBOR_SSE=true` in your `.env` (see [.env.example](.env.example)) and then plain `npm start` is
> enough. Either way, check the startup log for `[MCP Server] Using SSE transport` / `SSE server running on
> ...` to confirm it actually turned on before pointing a client at it.

For **SSE mode** in production, the process needs to keep running in the background (it doesn't daemonize
itself). Use a process manager such as [pm2](https://pm2.keymetrics.io/) or a systemd unit, for example:

```bash
pm2 start dist/app.js --name mcp-harbor -- --sse --sse-host 127.0.0.1 --sse-auth-token "$HARBOR_SSE_AUTH_TOKEN"
```

See [Securing the SSE Transport](#securing-the-sse-transport) before exposing SSE mode beyond `localhost`.

### Using It From an MCP Client (e.g. Claude Desktop)

The most common way to run this in "production" is not from a terminal at all — the MCP client spawns it
for you via **stdio** (see [Transport Modes](#transport-modes)). Point the client at the built binary and
pass credentials as arguments or environment variables, e.g. in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "harbor": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-harbor/dist/app.js"],
      "env": {
        "HARBOR_URL": "https://harbor.example.com",
        "HARBOR_USERNAME": "admin",
        "HARBOR_PASSWORD": "***"
      }
    }
  }
}
```

If installed globally (`npm install -g .`), you can use `"command": "mcp-harbor"` with `"args": []` instead.

## MCP Tools

The MCP server exposes the following tools:

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `list_projects` | List all projects in Harbor | None |
| `get_project` | Get project details by ID | `projectId: string` |
| `create_project` | Create a new project | `project_name: string, metadata?: object` |
| `delete_project` | Delete a project | `projectId: string` |
| `list_repositories` | List repositories in a project | `projectId: string` |
| `delete_repository` | Delete a repository | `projectId: string, repositoryName: string` |
| `list_tags` | List tags in a repository | `projectId: string, repositoryName: string` |
| `delete_tag` | Delete a tag | `projectId: string, repositoryName: string, tag: string` |
| `list_charts` | List Helm charts | `projectId: string` |
| `list_chart_versions` | List chart versions | `projectId: string, chartName: string` |
| `delete_chart` | Delete chart version | `projectId: string, chartName: string, version: string` |

## Development

### Running in Development Mode

Runs the TypeScript source directly (via `ts-node`'s ESM loader), no `npm run build` needed:

```bash
npm run dev -- --url https://harbor.example.com --username admin --password ***
# or, with a .env file in place:
npm run dev
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Project Structure

```
mcp-harbor
├── src
│   ├── app.ts                 # Main application entry point (MCP server)
│   ├── definitions
│   │   └── tool.definitions.ts # Tool definitions for MCP
│   ├── services
│   │   └── harbor.service.ts  # Harbor service implementation
│   └── types
│       └── index.ts           # TypeScript type definitions
├── test
│   └── harbor.test.ts         # Tests for Harbor service
├── .env.example              # Example environment variables
├── .gitignore               # Git ignore file
├── .eslintrc.json           # ESLint configuration
├── package.json            # Project dependencies
├── jest.config.js           # Jest configuration
├── tsconfig.test.json      # TypeScript configuration for tests
├── tsconfig.json          # TypeScript configuration
├── LICENSE                # Project license
└── README.md             # Project documentation
```

## Troubleshooting

### Common Issues

1. **Connection Failed**

    ```
    Error: Unable to connect to Harbor instance
    ```

    - Verify HARBOR_URL is correct and accessible
    - Check network connectivity
    - Ensure Harbor instance is running

2. **Authentication Failed**

    ```
    Error: Invalid credentials
    ```

    - Verify HARBOR_USERNAME and HARBOR_PASSWORD are correct
    - Check if user has required permissions

3. **Build Errors**

    ```
    Error: TypeScript compilation failed
    ```

    - Run `npm install` to ensure all dependencies are installed
    - Check TypeScript version compatibility
    - Clear the `dist` directory and rebuild

4. **`[MCP Error] SyntaxError: Unexpected end of JSON input` right after `npm start` / `npm run dev`**

    This is **not a crash** — the process keeps running. It happens because the default transport (stdio)
    expects every line on stdin to be a complete JSON-RPC message. If you run `npm start`/`npm run dev`
    directly in a terminal and press Enter (sending an empty line) or type plain text, it can't be parsed
    as JSON and this gets logged.

    stdio mode isn't meant to be typed into manually — it's meant to be spawned by an MCP client (see
    [Using It From an MCP Client](#using-it-from-an-mcp-client-eg-claude-desktop)). To sanity-check it from
    a terminal instead, either:

    - Pipe in a real JSON-RPC message: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npm start`
    - Or use `--sse` mode and test with `curl`/a browser against the [SSE endpoint](#connecting-to-the-sse-endpoint), which is easier to interact with manually.

### Debug Mode

Enable debug mode by using the `--debug` flag or setting:

```env
DEBUG=true
```

### Support

For additional help:

1. Review the application logs

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
