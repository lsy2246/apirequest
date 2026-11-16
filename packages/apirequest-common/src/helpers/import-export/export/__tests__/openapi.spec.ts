import { describe, expect, it } from "vitest"
import {
  makeRESTRequest,
  getDefaultRESTRequest,
  makeCollection,
  makeHoppRESTResponseOriginalRequest,
  HoppCollection,
  HoppRESTRequest,
  HoppRESTRequestResponse,
} from "@apirequest/data"
import * as E from "fp-ts/Either"
import { OpenAPI } from "openapi-types"
import SwaggerParser from "@apidevtools/swagger-parser"
import { hoppCollectionToOpenAPI, hoppCollectionsToOpenAPI } from "../openapi"

function buildCollection(
  overrides: Partial<Parameters<typeof makeCollection>[0]> = {}
) {
  return makeCollection({
    name: "Test Collection",
    requests: [],
    folders: [],
    auth: { authType: "inherit", authActive: true },
    headers: [],
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
    ...overrides,
  } as Parameters<typeof makeCollection>[0])
}

function buildRequest(
  overrides: Partial<Parameters<typeof makeRESTRequest>[0]> = {}
) {
  const base = getDefaultRESTRequest()
  return makeRESTRequest({
    ...base,
    ...overrides,
  } as Parameters<typeof makeRESTRequest>[0])
}

describe("hoppCollectionToOpenAPI", () => {
  it("produces a valid OpenAPI 3.1.0 document structure", () => {
    const collection = buildCollection({ name: "My API" })
    const { doc } = hoppCollectionToOpenAPI(collection)

    expect(doc.openapi).toBe("3.1.0")
    expect(doc.info.title).toBe("My API")
    expect(doc.info.version).toBe("1.0.0")
    expect(doc.paths).toBeDefined()
  })

  it("includes collection description in info", () => {
    const collection = buildCollection({
      name: "My API",
      description: "A test API",
    })
    const { doc } = hoppCollectionToOpenAPI(collection)

    expect(doc.info.description).toBe("A test API")
  })

  it("omits description when null", () => {
    const collection = buildCollection({ description: null })
    const { doc } = hoppCollectionToOpenAPI(collection)

    expect(doc.info.description).toBeUndefined()
  })

  describe("requests and paths", () => {
    it("converts a root-level GET request", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]).toBeDefined()
      expect(doc.paths!["/users"]!.get).toBeDefined()
      expect(doc.paths!["/users"]!.get!.summary).toBe("Get Users")
      expect(doc.paths!["/users"]!.get!.operationId).toBe("Get_Users")
    })

    it("extracts server URL from endpoint", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.servers).toEqual([{ url: "https://api.example.com" }])
    })

    it("deduplicates server URLs", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            endpoint: "https://api.example.com/users",
          }),
          buildRequest({
            name: "Get Posts",
            endpoint: "https://api.example.com/posts",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.servers).toHaveLength(1)
    })

    it("handles relative paths (no server)", () => {
      const collection = buildCollection({
        requests: [buildRequest({ name: "Test", endpoint: "/api/test" })],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.servers).toBeUndefined()
      expect(doc.paths!["/api/test"]).toBeDefined()
    })

    it("converts template variables <<var>> to {var}", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get User",
            endpoint: "https://api.example.com/users/<<id>>",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users/{id}"]).toBeDefined()
    })

    it("auto-generates path params for template variables without requestVariables", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get User",
            endpoint: "https://api.example.com/users/<<id>>/posts/<<postId>>",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/users/{id}/posts/{postId}"]!.get!
        .parameters as any[]

      const pathParams = params.filter((p: any) => p.in === "path")
      expect(pathParams).toHaveLength(2)
      expect(pathParams).toContainEqual(
        expect.objectContaining({ name: "id", in: "path", required: true })
      )
      expect(pathParams).toContainEqual(
        expect.objectContaining({ name: "postId", in: "path", required: true })
      )
    })

    it("does not duplicate path params already defined in requestVariables", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get User",
            endpoint: "https://api.example.com/users/<<id>>",
            requestVariables: [{ key: "id", value: "123", active: true }],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/users/{id}"]!.get!.parameters as any[]

      const pathParams = params.filter((p: any) => p.in === "path")
      expect(pathParams).toHaveLength(1)
      expect(pathParams[0].example).toBe("123")
    })

    it("deduplicates operationIds for requests with the same name", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
          buildRequest({
            name: "Get Users",
            method: "POST",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]!.get!.operationId).toBe("Get_Users")
      expect(doc.paths!["/users"]!.post!.operationId).toBe("Get_Users_2")
    })

    it("falls back to method_path operationId when name is all special characters", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "!!!",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]!.get!.operationId).toBe("get_users")
    })

    it("maps multiple HTTP methods to the same path", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
          buildRequest({
            name: "Create User",
            method: "POST",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]!.get).toBeDefined()
      expect(doc.paths!["/users"]!.post).toBeDefined()
    })

    it("includes request description when present", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get Users",
            endpoint: "https://api.example.com/users",
            description: "Fetches all users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]!.get!.description).toBe("Fetches all users")
    })
  })

  describe("parameters", () => {
    it("converts active query params", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Search",
            endpoint: "https://api.example.com/search",
            params: [
              { key: "q", value: "test", active: true, description: "" },
              {
                key: "inactive",
                value: "skip",
                active: false,
                description: "",
              },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/search"]!.get!.parameters as any[]

      expect(params).toHaveLength(1)
      expect(params[0]).toMatchObject({
        name: "q",
        in: "query",
        example: "test",
      })
    })

    it("converts active headers", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            headers: [
              { key: "X-Custom", value: "val", active: true, description: "" },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/test"]!.get!.parameters as any[]

      expect(params).toHaveLength(1)
      expect(params[0]).toMatchObject({
        name: "X-Custom",
        in: "header",
        example: "val",
      })
    })

    it("converts path variables as required", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get User",
            endpoint: "https://api.example.com/users/<<id>>",
            requestVariables: [{ key: "id", value: "123", active: true }],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/users/{id}"]!.get!.parameters as any[]

      const pathParam = params.find((p: any) => p.in === "path")
      expect(pathParam).toMatchObject({
        name: "id",
        in: "path",
        required: true,
        example: "123",
      })
    })

    it("omits parameters when none are active", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            params: [
              { key: "skip", value: "me", active: false, description: "" },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/test"]!.get!.parameters).toBeUndefined()
    })
  })

  describe("request body", () => {
    it("converts JSON body with parsed example", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Create User",
            method: "POST",
            endpoint: "https://api.example.com/users",
            body: {
              contentType: "application/json",
              body: '{"name":"John"}',
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const reqBody = doc.paths!["/users"]!.post!.requestBody as any

      expect(reqBody.content["application/json"].example).toEqual({
        name: "John",
      })
    })

    it("handles invalid JSON body gracefully", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            method: "POST",
            endpoint: "https://api.example.com/test",
            body: {
              contentType: "application/json",
              body: "not json",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const reqBody = doc.paths!["/test"]!.post!.requestBody as any

      expect(reqBody.content["application/json"].example).toBe("not json")
    })

    it("converts multipart/form-data body", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Upload",
            method: "POST",
            endpoint: "https://api.example.com/upload",
            body: {
              contentType: "multipart/form-data",
              body: [
                {
                  key: "file",
                  value: "",
                  active: true,
                  isFile: true,
                },
                {
                  key: "name",
                  value: "test",
                  active: true,
                  isFile: false,
                },
                {
                  key: "inactive",
                  value: "skip",
                  active: false,
                  isFile: false,
                },
              ],
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const schema = (doc.paths!["/upload"]!.post!.requestBody as any).content[
        "multipart/form-data"
      ].schema

      expect(schema.properties.file).toEqual({
        type: "string",
        format: "binary",
      })
      expect(schema.properties.name).toEqual({
        type: "string",
        example: "test",
      })
      expect(schema.properties.inactive).toBeUndefined()
    })

    it("converts form-urlencoded body", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Login",
            method: "POST",
            endpoint: "https://api.example.com/login",
            body: {
              contentType: "application/x-www-form-urlencoded",
              // APIRequest persists urlencoded bodies as RawKeyValue
              // (`key: value` per line) — match the on-disk format.
              body: "username: admin\npassword: secret",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const schema = (doc.paths!["/login"]!.post!.requestBody as any).content[
        "application/x-www-form-urlencoded"
      ].schema

      expect(schema.properties.username).toEqual({
        type: "string",
        example: "admin",
      })
      expect(schema.properties.password).toEqual({
        type: "string",
        example: "secret",
      })
    })

    it("converts plain text body", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Send Text",
            method: "POST",
            endpoint: "https://api.example.com/text",
            body: { contentType: "text/plain", body: "Hello world" },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const reqBody = doc.paths!["/text"]!.post!.requestBody as any

      expect(reqBody.content["text/plain"].example).toBe("Hello world")
    })

    it("omits requestBody when contentType is null", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "https://api.example.com/test",
            body: { contentType: null, body: null },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/test"]!.get!.requestBody).toBeUndefined()
    })
  })

  describe("authentication", () => {
    it("converts basic auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "basic",
              authActive: true,
              username: "user",
              password: "pass",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.basicAuth).toEqual({
        type: "http",
        scheme: "basic",
      })
      expect(doc.paths!["/test"]!.get!.security).toEqual([{ basicAuth: [] }])
    })

    it("converts bearer auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "bearer",
              authActive: true,
              token: "abc123",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.bearerAuth).toEqual({
        type: "http",
        scheme: "bearer",
      })
    })

    it("converts OAuth2 authorization code flow", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "AUTHORIZATION_CODE",
                authEndpoint: "https://auth.example.com/authorize",
                tokenEndpoint: "https://auth.example.com/token",
                clientID: "client123",
                clientSecret: "secret",
                scopes: "read write",
                isPKCE: false,
                codeVerifierMethod: "S256",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.type).toBe("oauth2")
      expect(scheme.flows.authorizationCode).toEqual({
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        scopes: { read: "", write: "" },
      })
    })

    it("converts OAuth2 client credentials flow", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "CLIENT_CREDENTIALS",
                authEndpoint: "https://auth.example.com/token",
                clientID: "client123",
                clientSecret: "secret",
                scopes: "admin",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.flows.clientCredentials).toEqual({
        tokenUrl: "https://auth.example.com/token",
        scopes: { admin: "" },
      })
    })

    it("converts OAuth2 password flow", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "PASSWORD",
                authEndpoint: "https://auth.example.com/token",
                clientID: "client123",
                clientSecret: "secret",
                username: "user",
                password: "pass",
                scopes: "",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.flows.password).toEqual({
        tokenUrl: "https://auth.example.com/token",
        scopes: {},
      })
    })

    it("converts OAuth2 implicit flow", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "IMPLICIT",
                authEndpoint: "https://auth.example.com/authorize",
                clientID: "client123",
                scopes: "profile email",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.flows.implicit).toEqual({
        authorizationUrl: "https://auth.example.com/authorize",
        scopes: { profile: "", email: "" },
      })
      expect(doc.paths!["/test"]!.get!.security).toEqual([
        { oauth2: ["profile", "email"] },
      ])
    })

    it("merges OAuth2 flows across requests with different grant types", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Auth Code Request",
            endpoint: "https://api.example.com/a",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "AUTHORIZATION_CODE",
                authEndpoint: "https://auth.example.com/authorize",
                tokenEndpoint: "https://auth.example.com/token",
                clientID: "c",
                clientSecret: "s",
                scopes: "read",
                isPKCE: false,
                codeVerifierMethod: "S256",
                token: "",
              },
            } as any,
          }),
          buildRequest({
            name: "Client Credentials Request",
            endpoint: "https://api.example.com/b",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "CLIENT_CREDENTIALS",
                authEndpoint: "https://auth.example.com/token",
                clientID: "c",
                clientSecret: "s",
                scopes: "admin",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.flows.authorizationCode).toEqual({
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        scopes: { read: "" },
      })
      expect(scheme.flows.clientCredentials).toEqual({
        tokenUrl: "https://auth.example.com/token",
        scopes: { admin: "" },
      })
      expect(doc.paths!["/a"]!.get!.security).toEqual([{ oauth2: ["read"] }])
      expect(doc.paths!["/b"]!.get!.security).toEqual([{ oauth2: ["admin"] }])
    })

    it("unions OAuth2 scopes across requests sharing a grant type and endpoints", () => {
      const grantInfo = {
        grantType: "AUTHORIZATION_CODE" as const,
        authEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
        clientID: "c",
        clientSecret: "s",
        isPKCE: false,
        codeVerifierMethod: "S256" as const,
        token: "",
      }
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Read",
            endpoint: "https://api.example.com/read",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: { ...grantInfo, scopes: "read:users" },
            } as any,
          }),
          buildRequest({
            name: "Write",
            endpoint: "https://api.example.com/write",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: { ...grantInfo, scopes: "write:users" },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      expect(scheme.flows.authorizationCode.scopes).toEqual({
        "read:users": "",
        "write:users": "",
      })
      expect(doc.paths!["/read"]!.get!.security).toEqual([
        { oauth2: ["read:users"] },
      ])
      expect(doc.paths!["/write"]!.get!.security).toEqual([
        { oauth2: ["write:users"] },
      ])
    })

    it("flags OAuth2 endpoint conflicts within a shared grant type as lossy", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Service A",
            endpoint: "https://a.example.com/a-resource",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "AUTHORIZATION_CODE",
                authEndpoint: "https://a.example.com/authorize",
                tokenEndpoint: "https://a.example.com/token",
                clientID: "c",
                clientSecret: "s",
                scopes: "read",
                isPKCE: false,
                codeVerifierMethod: "S256",
                token: "",
              },
            } as any,
          }),
          buildRequest({
            name: "Service B",
            endpoint: "https://b.example.com/b-resource",
            auth: {
              authType: "oauth-2",
              authActive: true,
              addTo: "HEADERS",
              grantTypeInfo: {
                grantType: "AUTHORIZATION_CODE",
                authEndpoint: "https://b.example.com/authorize",
                tokenEndpoint: "https://b.example.com/token",
                clientID: "c",
                clientSecret: "s",
                scopes: "read",
                isPKCE: false,
                codeVerifierMethod: "S256",
                token: "",
              },
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes!.oauth2 as any

      // Earlier endpoints win; later conflicting endpoints drop silently.
      expect(scheme.flows.authorizationCode.authorizationUrl).toBe(
        "https://a.example.com/authorize"
      )
      expect(scheme.flows.authorizationCode.tokenUrl).toBe(
        "https://a.example.com/token"
      )
    })

    it("converts API key auth in header", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "X-API-Key",
              value: "secret",
              addTo: "HEADERS",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes![
        "apiKey_header_X-API-Key"
      ] as any

      expect(scheme).toEqual({
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      })
    })

    it("converts API key auth in query params", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "api_key",
              value: "secret",
              addTo: "QUERY_PARAMS",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const scheme = doc.components!.securitySchemes![
        "apiKey_query_api_key"
      ] as any

      expect(scheme).toEqual({
        type: "apiKey",
        in: "query",
        name: "api_key",
      })
    })

    it("converts JWT auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "jwt",
              authActive: true,
              secret: "s3cret",
              privateKey: "",
              algorithm: "HS256",
              payload: "{}",
              addTo: "HEADERS",
              headerPrefix: "Bearer",
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.jwtAuth).toEqual({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      })
      expect(doc.paths!["/test"]!.get!.security).toEqual([{ jwtAuth: [] }])
    })

    it("converts digest auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "digest",
              authActive: true,
              username: "user",
              password: "pass",
              realm: "",
              nonce: "",
              algorithm: "MD5",
              qop: "auth",
              nc: "",
              cnonce: "",
              opaque: "",
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.digestAuth).toEqual({
        type: "http",
        scheme: "digest",
      })
    })

    it("converts AWS Signature auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "aws-signature",
              authActive: true,
              accessKey: "AKIA...",
              secretKey: "secret",
              region: "us-east-1",
              serviceName: "s3",
              addTo: "HEADERS",
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.awsSigV4).toEqual({
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "AWS Signature Version 4",
      })
    })

    it("converts HAWK auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "hawk",
              authActive: true,
              authId: "id123",
              authKey: "key456",
              algorithm: "sha256",
              includePayloadHash: false,
              timestamp: "",
              nonce: "",
              ext: "",
              app: "",
              dlg: "",
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.hawkAuth).toEqual({
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "Hawk authentication",
      })
    })

    it("converts Akamai EdgeGrid auth", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "akamai-eg",
              authActive: true,
              accessToken: "token",
              clientToken: "client",
              clientSecret: "secret",
              baseURL: "",
              timestamp: "",
              nonce: "",
              headersToSign: "",
              maxBodySize: 131072,
            } as any,
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components!.securitySchemes!.akamaiEdgeGrid).toEqual({
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "Akamai EdgeGrid authentication",
      })
    })

    it("skips auth when authActive is false", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            auth: {
              authType: "basic",
              authActive: false,
              username: "user",
              password: "pass",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.components).toBeUndefined()
      expect(doc.paths!["/test"]!.get!.security).toBeUndefined()
    })

    it("exports collection-level auth as global security", () => {
      const collection = buildCollection({
        auth: {
          authType: "basic",
          authActive: true,
          username: "user",
          password: "pass",
        },
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.security).toEqual([{ basicAuth: [] }])
      expect(doc.components!.securitySchemes!.basicAuth).toEqual({
        type: "http",
        scheme: "basic",
      })
    })

    it("skips global security for inherit/none collection auth", () => {
      const collection = buildCollection({
        auth: { authType: "inherit", authActive: true },
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.security).toBeUndefined()
    })

    it("sets security to empty array when authType is none and authActive is true", () => {
      const collection = buildCollection({
        auth: {
          authType: "basic",
          authActive: true,
          username: "u",
          password: "p",
        },
        requests: [
          buildRequest({
            name: "Public",
            endpoint: "https://api.example.com/health",
            auth: { authType: "none", authActive: true },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.security).toEqual([{ basicAuth: [] }])
      expect(doc.paths!["/health"]!.get!.security).toEqual([])
    })
  })

  describe("collection-level headers", () => {
    it("includes collection-level headers in operation parameters", () => {
      const collection = buildCollection({
        headers: [
          {
            key: "X-Global",
            value: "global-val",
            active: true,
            description: "",
          },
        ],
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/test"]!.get!.parameters as any[]

      expect(params).toContainEqual(
        expect.objectContaining({
          name: "X-Global",
          in: "header",
          example: "global-val",
        })
      )
    })

    it("request headers override collection headers (case-insensitive)", () => {
      const collection = buildCollection({
        headers: [
          {
            key: "X-Custom",
            value: "collection-val",
            active: true,
            description: "",
          },
        ],
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            headers: [
              {
                key: "x-custom",
                value: "request-val",
                active: true,
                description: "",
              },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/test"]!.get!.parameters as any[]

      const headerParams = params.filter((p: any) => p.in === "header")
      expect(headerParams).toHaveLength(1)
      expect(headerParams[0].example).toBe("request-val")
    })
  })

  describe("folders and tags", () => {
    it("creates tags from folders", () => {
      const collection = buildCollection({
        folders: [
          buildCollection({
            name: "Users",
            requests: [
              buildRequest({
                name: "List Users",
                endpoint: "https://api.example.com/users",
              }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.tags).toContainEqual({ name: "Users" })
      expect(doc.paths!["/users"]!.get!.tags).toEqual(["Users"])
    })

    it("creates nested tag paths for nested folders", () => {
      const collection = buildCollection({
        folders: [
          buildCollection({
            name: "API",
            folders: [
              buildCollection({
                name: "Users",
                requests: [
                  buildRequest({
                    name: "List",
                    endpoint: "https://api.example.com/users",
                  }),
                ],
              }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.tags).toContainEqual({ name: "API" })
      expect(doc.tags).toContainEqual({ name: "API/Users" })
      expect(doc.paths!["/users"]!.get!.tags).toEqual(["API/Users"])
    })

    it("root-level requests have no tags", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Health",
            endpoint: "https://api.example.com/health",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/health"]!.get!.tags).toBeUndefined()
      expect(doc.tags).toBeUndefined()
    })
  })

  describe("responses", () => {
    it("generates default 200 response when no responses saved", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            responses: {},
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/test"]!.get!.responses).toEqual({
        "200": { description: "Successful response" },
      })
    })

    it("converts saved responses with body and headers", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            responses: {
              resp1: {
                name: "Success",
                code: 200,
                status: "OK",
                headers: [
                  { key: "Content-Type", value: "application/json" },
                  { key: "X-Request-Id", value: "abc" },
                ],
                body: '{"result":"ok"}',
              } as any,
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const resp = doc.paths!["/test"]!.get!.responses["200"] as any

      expect(resp.description).toBe("Success")
      expect(resp.headers["X-Request-Id"].example).toBe("abc")
      expect(resp.content["application/json"].example).toEqual({
        result: "ok",
      })
    })

    it("falls back to default 200 when every saved response has a null code", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            responses: {
              resp1: {
                name: "draft",
                code: null,
                status: "",
                headers: [],
                body: "",
              } as any,
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/test"]!.get!.responses).toEqual({
        "200": { description: "Successful response" },
      })
    })
  })

  describe("dropped output", () => {
    it("drops duplicate (path, method) operations — first wins", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "First",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
          buildRequest({
            name: "Second",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/users"]!.get!.summary).toBe("First")
    })

    it("skips operations with HTTP methods OpenAPI does not support", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Connect Tunnel",
            method: "CONNECT",
            endpoint: "https://api.example.com/tunnel",
          }),
          buildRequest({
            name: "Get Users",
            method: "GET",
            endpoint: "https://api.example.com/users",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/tunnel"]).toBeUndefined()
      expect(doc.paths!["/users"]).toBeDefined()
    })
  })

  describe("path template variables (regression)", () => {
    // These tests document the BLOCKER fix: the WHATWG URL parser
    // percent-encodes `{}` to `%7B%7D` in pathnames. The converter must
    // decode those back so OpenAPI path parameters land correctly.
    it("preserves {var} placeholders that the URL parser percent-encoded", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "https://api.example.com/users/{id}",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/users/{id}"]).toBeDefined()
    })

    it("converts <<var>> in absolute URLs to {var} after URL parsing", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "https://api.example.com/users/<<id>>/posts/<<postId>>",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/users/{id}/posts/{postId}"]).toBeDefined()
    })

    it("preserves intentionally percent-encoded path segments (e.g. %2F)", () => {
      // Regression: an over-eager decodeURIComponent on the whole pathname
      // would turn `%2F` into a literal `/`, splitting a single segment in two.
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "https://api.example.com/files/a%2Fb/info",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/files/a%2Fb/info"]).toBeDefined()
      expect(doc.paths!["/files/a/b/info"]).toBeUndefined()
    })

    it("strips fragments from relative endpoints", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({ name: "Get", endpoint: "/users/list#section" }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/users/list"]).toBeDefined()
      expect(doc.paths!["/users/list#section"]).toBeUndefined()
    })

    it("treats a leading <<var>> as the server, not as a path segment", () => {
      // Regression: `<<baseUrl>>/pets/9704` was previously kept whole inside
      // the path, then importer-side double-prefixed `<<baseUrl>>` on round-trip.
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Get pet",
            endpoint: "<<baseUrl>>/pets/9704",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)

      expect(doc.paths!["/pets/9704"]).toBeDefined()
      // The leading variable lands in servers, not in any path key
      expect(doc.paths!["/<<baseUrl>>/pets/9704"]).toBeUndefined()
      expect(doc.paths!["/{baseUrl}/pets/9704"]).toBeUndefined()
      expect(doc.servers).toEqual([{ url: "<<baseUrl>>" }])
    })

    it("handles a bare leading <<var>> with no path", () => {
      const collection = buildCollection({
        requests: [buildRequest({ name: "Root", endpoint: "<<baseUrl>>" })],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/"]).toBeDefined()
      expect(doc.servers).toEqual([{ url: "<<baseUrl>>" }])
    })

    it("resolves a leading <<var>> to its collection-variable value in servers", () => {
      // Regression: previously the doc shipped `servers: [{ url: "<<baseUrl>>" }]`
      // even when the collection knew the actual host. OpenAPI consumers can't
      // resolve APIRequest placeholders, so we substitute the value here.
      const collection = buildCollection({
        variables: [
          {
            key: "baseUrl",
            initialValue: "https://api.petstore.com",
            currentValue: "https://api.petstore.com",
            secret: false,
          },
        ],
        requests: [
          buildRequest({
            name: "Get pet",
            endpoint: "<<baseUrl>>/pets/9704",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.servers).toEqual([{ url: "https://api.petstore.com" }])
      expect(doc.paths!["/pets/9704"]).toBeDefined()
    })

    it("works for any variable name, not only baseUrl", () => {
      const collection = buildCollection({
        variables: [
          {
            key: "petstoreHost",
            initialValue: "https://api.petstore.com",
            currentValue: "https://api.petstore.com",
            secret: false,
          },
        ],
        requests: [
          buildRequest({
            name: "Get pet",
            endpoint: "<<petstoreHost>>/pets/9704",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.servers).toEqual([{ url: "https://api.petstore.com" }])
    })

    it("does not leak secret variables into the exported servers", () => {
      const collection = buildCollection({
        variables: [
          {
            key: "secretHost",
            initialValue: "https://internal.example.com",
            currentValue: "https://internal.example.com",
            secret: true,
          },
        ],
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "<<secretHost>>/api/x",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      // Falls back to the placeholder so the user can see something is off,
      // rather than embedding a secret value into the spec.
      expect(doc.servers).toEqual([{ url: "<<secretHost>>" }])
    })

    it("falls back to placeholder when no matching variable exists", () => {
      const collection = buildCollection({
        variables: [],
        requests: [
          buildRequest({
            name: "Get",
            endpoint: "<<unknown>>/path",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.servers).toEqual([{ url: "<<unknown>>" }])
    })

    it("uses currentValue, falling back to initialValue", () => {
      const collection = buildCollection({
        variables: [
          {
            key: "baseUrl",
            initialValue: "https://prod.example.com",
            currentValue: "https://staging.example.com",
            secret: false,
          },
        ],
        requests: [buildRequest({ name: "Get", endpoint: "<<baseUrl>>/x" })],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.servers).toEqual([{ url: "https://staging.example.com" }])
    })

    it("a deeper folder variable overrides a collection variable", () => {
      const collection = buildCollection({
        variables: [
          {
            key: "baseUrl",
            initialValue: "https://prod.example.com",
            currentValue: "https://prod.example.com",
            secret: false,
          },
        ],
        folders: [
          buildCollection({
            name: "Sandbox",
            variables: [
              {
                key: "baseUrl",
                initialValue: "https://sandbox.example.com",
                currentValue: "https://sandbox.example.com",
                secret: false,
              },
            ],
            requests: [
              buildRequest({ name: "Get", endpoint: "<<baseUrl>>/x" }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.servers).toEqual([{ url: "https://sandbox.example.com" }])
    })
  })

  describe("URL query string handling", () => {
    it("extracts query params from absolute URL into operation parameters", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Search",
            endpoint: "https://api.example.com/search?q=hello&limit=10",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/search"]!.get!.parameters as any[]

      // path key has no `?`
      expect(doc.paths!["/search?q=hello&limit=10"]).toBeUndefined()
      const queryParams = params.filter((p: any) => p.in === "query")
      expect(queryParams).toContainEqual(
        expect.objectContaining({ name: "q", example: "hello" })
      )
      expect(queryParams).toContainEqual(
        expect.objectContaining({ name: "limit", example: "10" })
      )
    })

    it("strips query string from a relative endpoint and exposes its params", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Filter",
            endpoint: "/users?active=true",
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/users"]).toBeDefined()
      // path key must not contain `?`
      expect(doc.paths!["/users?active=true"]).toBeUndefined()
      const params = doc.paths!["/users"]!.get!.parameters as any[]
      const queryParams = params.filter((p: any) => p.in === "query")
      expect(queryParams).toContainEqual(
        expect.objectContaining({ name: "active", example: "true" })
      )
    })

    it("explicit request.params take precedence over duplicates in URL", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Search",
            endpoint: "https://api.example.com/search?q=from-url",
            params: [
              {
                key: "q",
                value: "from-explicit",
                active: true,
                description: "",
              },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/search"]!.get!.parameters as any[]
      const queryParams = params.filter((p: any) => p.in === "query")
      expect(queryParams).toHaveLength(1)
      expect(queryParams[0].example).toBe("from-explicit")
    })
  })

  describe("parameter de-duplication", () => {
    it("dedupes duplicate query params (first wins)", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/test",
            params: [
              { key: "page", value: "1", active: true, description: "" },
              { key: "page", value: "2", active: true, description: "" },
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/test"]!.get!.parameters as any[]
      const queryParams = params.filter((p: any) => p.in === "query")
      expect(queryParams).toHaveLength(1)
      expect(queryParams[0].example).toBe("1")
    })

    it("dedupes duplicate path params introduced both via requestVariables and path", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "Test",
            endpoint: "https://api.example.com/users/<<id>>/posts/<<id>>",
            requestVariables: [{ key: "id", value: "42", active: true }],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const params = doc.paths!["/users/{id}/posts/{id}"]!.get!
        .parameters as any[]
      const pathParams = params.filter((p: any) => p.in === "path")
      expect(pathParams).toHaveLength(1)
      expect(pathParams[0].name).toBe("id")
    })
  })

  describe("auth inheritance", () => {
    it("operation inherits folder-level auth when request auth is inherit", () => {
      const collection = buildCollection({
        folders: [
          buildCollection({
            name: "Authenticated",
            auth: {
              authType: "basic",
              authActive: true,
              username: "u",
              password: "p",
            },
            requests: [
              buildRequest({
                name: "Get Secure",
                endpoint: "https://api.example.com/secure",
                auth: { authType: "inherit", authActive: true },
              }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/secure"]!.get!.security).toEqual([{ basicAuth: [] }])
      expect(doc.components!.securitySchemes!.basicAuth).toEqual({
        type: "http",
        scheme: "basic",
      })
    })

    it("nested folder auth wins over collection auth via inherit", () => {
      const collection = buildCollection({
        auth: {
          authType: "basic",
          authActive: true,
          username: "u",
          password: "p",
        },
        folders: [
          buildCollection({
            name: "Inner",
            auth: { authType: "bearer", authActive: true, token: "t" },
            requests: [
              buildRequest({
                name: "Get",
                endpoint: "https://api.example.com/inner",
                auth: { authType: "inherit", authActive: true },
              }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/inner"]!.get!.security).toEqual([{ bearerAuth: [] }])
    })

    it("folder auth=none under collection auth produces empty operation security", () => {
      const collection = buildCollection({
        auth: {
          authType: "basic",
          authActive: true,
          username: "u",
          password: "p",
        },
        folders: [
          buildCollection({
            name: "Public",
            auth: { authType: "none", authActive: true },
            requests: [
              buildRequest({
                name: "Health",
                endpoint: "https://api.example.com/public/health",
                auth: { authType: "inherit", authActive: true },
              }),
            ],
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      expect(doc.paths!["/public/health"]!.get!.security).toEqual([])
      expect(doc.security).toEqual([{ basicAuth: [] }])
    })
  })

  describe("API key scheme name collisions", () => {
    it("disambiguates API-key schemes that sanitize to the same name", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "A",
            endpoint: "https://api.example.com/a",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "X@Api-Key",
              value: "v1",
              addTo: "HEADERS",
            },
          }),
          buildRequest({
            name: "B",
            endpoint: "https://api.example.com/b",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "X#Api-Key",
              value: "v2",
              addTo: "HEADERS",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const schemes = doc.components!.securitySchemes!
      const schemeNames = Object.keys(schemes)
      // both schemes should exist under different names; neither should silently overwrite
      expect(schemeNames).toHaveLength(2)
      // each operation should reference its own scheme
      const aSec = doc.paths!["/a"]!.get!.security as any[]
      const bSec = doc.paths!["/b"]!.get!.security as any[]
      expect(Object.keys(aSec[0])[0]).not.toBe(Object.keys(bSec[0])[0])
      // but the underlying scheme.name fields should differ
      const aSchemeName = Object.keys(aSec[0])[0]
      const bSchemeName = Object.keys(bSec[0])[0]
      expect((schemes[aSchemeName] as any).name).toBe("X@Api-Key")
      expect((schemes[bSchemeName] as any).name).toBe("X#Api-Key")
    })

    it("reuses the scheme name when two API-key schemes are identical", () => {
      const collection = buildCollection({
        requests: [
          buildRequest({
            name: "A",
            endpoint: "https://api.example.com/a",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "X-Api-Key",
              value: "v",
              addTo: "HEADERS",
            },
          }),
          buildRequest({
            name: "B",
            endpoint: "https://api.example.com/b",
            auth: {
              authType: "api-key",
              authActive: true,
              key: "X-Api-Key",
              value: "v",
              addTo: "HEADERS",
            },
          }),
        ],
      })
      const { doc } = hoppCollectionToOpenAPI(collection)
      const schemes = doc.components!.securitySchemes!
      expect(Object.keys(schemes)).toHaveLength(1)
    })
  })
})

// Round-trip audit: HoppCollection -> OpenAPI 3.1 -> HoppCollection.
// Tests labelled `LOSSY` document a known and disclosed loss; tests without
// that label assert exact preservation. New regressions surfaced by the
// audit land here.

const buildResponse = (
  overrides: {
    name?: string
    code?: number
    status?: string
    headers?: Array<{ key: string; value: string }>
    body?: string
  } = {}
): HoppRESTRequestResponse =>
  ({
    name: "Success",
    code: 200,
    status: "OK",
    headers: [],
    body: "",
    ...overrides,
    originalRequest: makeHoppRESTResponseOriginalRequest({
      name: "Test",
      method: "GET",
      endpoint: "https://api.example.com/test",
      params: [],
      headers: [],
      auth: { authType: "inherit", authActive: true },
      body: { contentType: null, body: null },
      requestVariables: [],
    }),
  }) as HoppRESTRequestResponse

const buildColl = (
  overrides: Partial<Parameters<typeof makeCollection>[0]> = {}
) =>
  makeCollection({
    name: "Round Trip",
    requests: [],
    folders: [],
    auth: { authType: "inherit", authActive: true },
    headers: [],
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
    ...overrides,
  } as Parameters<typeof makeCollection>[0])

const buildReq = (
  overrides: Partial<Parameters<typeof makeRESTRequest>[0]> = {}
) =>
  makeRESTRequest({
    name: "Test",
    method: "GET",
    endpoint: "https://api.example.com/test",
    params: [],
    headers: [],
    preRequestScript: "",
    testScript: "",
    auth: { authType: "inherit", authActive: true },
    body: { contentType: null, body: null },
    requestVariables: [],
    responses: {},
    description: null,
    ...overrides,
  } as Parameters<typeof makeRESTRequest>[0])

// `HoppCollection["requests"]` is a union of REST and GQL; every fixture below
// builds REST. These accessors narrow the union so tests can read REST-only
// fields (`requestVariables`, `responses`, `method`) without per-call casts.
const restRequestsOf = (c: HoppCollection | undefined): HoppRESTRequest[] =>
  (c?.requests ?? []) as HoppRESTRequest[]

const firstReq = (c: HoppCollection): HoppRESTRequest | undefined => {
  const direct = restRequestsOf(c)[0]
  if (direct) return direct
  const inFolder = restRequestsOf(c.folders[0])[0]
  if (inFolder) return inFolder
  return restRequestsOf(c.folders[0]?.folders[0])[0]
}

// Validates the exported doc against the OpenAPI 3.1 spec via SwaggerParser.
// Catches output that's structurally invalid even if our own importer is lenient.
describe("exported doc validates against OpenAPI 3.1 spec", () => {
  const validate = async (collection: HoppCollection) => {
    const { doc } = hoppCollectionToOpenAPI(collection)
    // SwaggerParser mutates input; clone first.
    const cloned = JSON.parse(JSON.stringify(doc))
    await SwaggerParser.validate(cloned)
  }

  it("a minimal collection produces a valid OpenAPI 3.1 doc", async () => {
    await expect(
      validate(
        buildColl({
          requests: [buildReq({ endpoint: "https://api.example.com/pets" })],
        })
      )
    ).resolves.not.toThrow()
  })

  it("a collection with auth + headers + body validates", async () => {
    await expect(
      validate(
        buildColl({
          requests: [
            buildReq({
              method: "POST",
              endpoint: "https://api.example.com/pets",
              headers: [
                {
                  key: "X-Custom",
                  value: "abc",
                  active: true,
                  description: "",
                },
              ],
              params: [
                {
                  key: "draft",
                  value: "true",
                  active: true,
                  description: "",
                },
              ],
              auth: {
                authType: "bearer",
                authActive: true,
                token: "tk",
              },
              body: {
                contentType: "application/json",
                body: '{"name":"Buddy"}',
              },
            }),
          ],
        })
      )
    ).resolves.not.toThrow()
  })

  it("a collection with nested folders validates", async () => {
    await expect(
      validate(
        buildColl({
          folders: [
            buildColl({
              name: "API",
              folders: [
                buildColl({
                  name: "Users",
                  requests: [
                    buildReq({
                      name: "List",
                      endpoint: "https://api.example.com/users",
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      )
    ).resolves.not.toThrow()
  })

  it("a collection that resolves a baseUrl variable validates (no <<>> in spec output)", async () => {
    await expect(
      validate(
        buildColl({
          variables: [
            {
              key: "baseUrl",
              initialValue: "https://api.example.com",
              currentValue: "https://api.example.com",
              secret: false,
            },
          ],
          requests: [buildReq({ endpoint: "<<baseUrl>>/pets" })],
        })
      )
    ).resolves.not.toThrow()
  })

  it("a collection with path collisions validates with x-apirequest-dropped-requests present", async () => {
    await expect(
      validate(
        buildColl({
          requests: [
            buildReq({
              name: "Kept",
              method: "GET",
              endpoint: "https://api.example.com/items",
            }),
            buildReq({
              name: "Dropped",
              method: "GET",
              endpoint: "https://api.example.com/items",
            }),
          ],
        })
      )
    ).resolves.not.toThrow()
  })

  it("a multi-collection workspace doc validates with x-apirequest-workspace-root present", async () => {
    const collections = [
      buildColl({
        name: "ColA",
        requests: [
          buildReq({ name: "A", endpoint: "https://api.example.com/a" }),
        ],
      }),
      buildColl({
        name: "ColB",
        requests: [
          buildReq({ name: "B", endpoint: "https://api.example.com/b" }),
        ],
      }),
    ]
    const { doc } = hoppCollectionsToOpenAPI("WS", collections)
    const cloned = JSON.parse(JSON.stringify(doc))
    await expect(SwaggerParser.validate(cloned)).resolves.not.toThrow()
  })

  it("a workspace with nested folders + path collisions validates with both markers present", async () => {
    const collections = [
      buildColl({
        name: "ColA",
        folders: [
          buildColl({
            name: "API",
            requests: [
              buildReq({
                name: "Kept",
                method: "GET",
                endpoint: "https://api.example.com/items",
              }),
              buildReq({
                name: "Dropped",
                method: "GET",
                endpoint: "https://api.example.com/items",
              }),
            ],
          }),
        ],
      }),
    ]
    const { doc } = hoppCollectionsToOpenAPI("WS", collections)
    const cloned = JSON.parse(JSON.stringify(doc))
    await expect(SwaggerParser.validate(cloned)).resolves.not.toThrow()
  })
})

// Test fixtures intentionally use permissively-typed OpenAPI documents so we
// can build minimal docs without satisfying every required field.
type DocOverrides = {
  paths: Record<string, unknown>
  info?: { title?: string; description?: string; version?: string }
  tags?: Array<{ name: string; description?: string }>
  [extension: `x-${string}`]: unknown
}

const buildOpenAPIDoc = (overrides: DocOverrides): OpenAPI.Document =>
  ({
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    ...overrides,
  }) as unknown as OpenAPI.Document

type OpStub = {
  summary: string
  operationId: string
  tags: string[]
  responses: Record<string, { description: string }>
}

const op = (tags: string[], summary: string): OpStub => ({
  summary,
  operationId: summary.replace(/\W+/g, "_"),
  tags,
  responses: { "200": { description: "ok" } },
})
