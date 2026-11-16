# Security

API Request is an API development tool with a local Tauri desktop client and an optional self-hosted web service.

The desktop app stores workspace data in its application data directory. Credentials, request bodies, history responses and traffic capture archives may contain sensitive data. Requests and connections go to the destinations explicitly configured by the user. TLS, certificate and proxy options apply to the user's requests.

AI access uses a local MCP endpoint and connection credentials. Capturing traffic, trusting a capture certificate and changing system proxy settings are explicit user actions. The desktop build bundles its capture engine. There is currently no automatic application updater or default cloud API endpoint.

The web service requires authentication and correctly configured allowed origins when deployed beyond the single-user local environment. Local single-user mode is intended for loopback access only.

Report security issues through [this repository's security advisory page](https://github.com/lsy2246/apirequest/security/advisories/new). Do not include credentials or private traffic in public issues. For ordinary bugs, use [Issues](https://github.com/lsy2246/apirequest/issues).
