# API Request

A local API workbench for HTTP, GraphQL, WebSocket, API documentation, Mock services, automated tests and traffic capture.

- [Desktop setup and builds](desktop/README.md)
- [Mock workbench](docs/mock-workbench.md)
- [AI access through MCP](docs/workbench-mcp.md)
- [Change notes](docs/changes/README.md)
- [Third-party source and dependency notices](THIRD_PARTY_NOTICES.md)

## Local web development

Use Node.js 24 and the pnpm version pinned in `package.json`. Copy `.env.example` to `.env` and configure the local database before starting the backend. Single-user mode is for loopback access.

```sh
pnpm install
pnpm --filter apirequest-backend run start:dev
pnpm --filter @apirequest/selfhost-web run dev
```

The web client uses the backend URL configured in the environment. The command-line runner requires an explicit server URL for remote resources. No public cloud server is selected automatically.

The application uses API Request package names, data scopes and export metadata directly. This source does not add migration or fallback aliases for the previous project identifiers.
