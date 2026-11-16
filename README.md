# API Request

A local API workbench for HTTP, GraphQL, WebSocket, API documentation, Mock services, automated tests and traffic capture.

- [Desktop setup and builds](desktop/README.md)
- [Mock workbench](docs/mock-workbench.md)
- [AI access through MCP](docs/workbench-mcp.md)
- [Change notes](docs/changes/README.md)
- [Third-party source and dependency notices](THIRD_PARTY_NOTICES.md)

## Local web development

Use Node.js 24 and the pnpm version pinned in `package.json`. Copy `.env.example` to `.env` and configure the local database before starting the backend. The workspace always uses a single user with automatic sign-in and defaults to loopback access. LAN test deployments can explicitly set `APIREQUEST_ALLOW_LAN_ACCESS=true` with matching private IPv4 hosts in the frontend and backend URLs. `APIREQUEST_WEB_ROOT` serves the built web client from the backend; `APIREQUEST_TLS_CERT` and `APIREQUEST_TLS_KEY` enable HTTPS on the same port.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm ci:prepare
pnpm --filter apirequest-backend run start:dev
pnpm --filter @apirequest/selfhost-web run dev
```

The web client uses the backend URL configured in the environment. The command-line runner requires an explicit server URL for remote resources. No public cloud server is selected automatically.

The application uses API Request package names, data scopes and export metadata directly. This source does not add migration or fallback aliases for the previous project identifiers.
