import * as E from "fp-ts/Either"
import { EMPTY } from "rxjs"
import { expect, it, vi } from "vitest"
import { initBackendGQLClient, runGQLQuery, runMutation } from "../GQLClient"
import { backendOperation } from "../operation"

const { send } = vi.hoisted(() => {
  vi.stubEnv("VITE_BACKEND_GQL_URL", "https://backend.example.test/graphql")
  vi.stubEnv("VITE_BACKEND_WS_URL", "wss://backend.example.test/graphql")
  return { send: vi.fn<typeof fetch>() }
})

vi.mock("~/platform", () => ({
  platform: {
    auth: {
      getAuthEventsStream: () => EMPTY,
      getProbableUser: () => null,
      getBackendHeaders: () => ({}),
      willBackendHaveAuthError: () => false,
      getGQLClientOptions: () => ({ fetch: send }),
      onBackendGQLClientShouldReconnect: () => {},
    },
  },
}))

it("loads the web documents and sends named backend operations", async () => {
  const environments = { me: { environments: [] } }
  const updated = {
    updateRESTUserRequest: { id: "request-id", collectionID: "collection-id", request: "{}" },
  }
  const reply = (data: object) =>
    new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    })

  send.mockResolvedValueOnce(reply(environments))
  send.mockResolvedValueOnce(reply(updated))
  await initBackendGQLClient()

  const query = await runGQLQuery({
    query: backendOperation("GetUserEnvironmentsDocument"),
    variables: {},
  })
  const mutation = await runMutation(
    backendOperation("UpdateRestUserRequestDocument"),
    { id: "request-id", title: "renamed", request: "{}" }
  )()

  expect(query).toEqual(E.right(environments))
  expect(mutation).toEqual(E.right(updated))
  const [queryBody, mutationBody] = send.mock.calls.map(([, init]) =>
    JSON.parse(String(init?.body))
  )
  expect(queryBody).toMatchObject({
    query: expect.stringContaining("query GetUserEnvironments"),
    variables: {},
  })
  expect(mutationBody).toMatchObject({
    query: expect.stringContaining("mutation UpdateRESTUserRequest"),
    variables: { id: "request-id", title: "renamed", request: "{}" },
  })
})
