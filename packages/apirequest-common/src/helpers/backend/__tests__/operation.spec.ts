import * as E from "fp-ts/Either"
import { EMPTY } from "rxjs"
import { expect, it, vi } from "vitest"
import { initBackendGQLClient, runGQLQuery, runMutation } from "../GQLClient"
import { backendOperation } from "../operation"

const { send } = vi.hoisted(() => ({ send: vi.fn<typeof fetch>() }))

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
  const environments = { team: { teamEnvironments: [] } }
  const updated = { updateRequest: { id: "request-id" } }
  const reply = (data: object) =>
    new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    })

  send.mockResolvedValueOnce(reply(environments))
  send.mockResolvedValueOnce(reply(updated))
  await initBackendGQLClient()

  const query = await runGQLQuery({
    query: backendOperation("GetTeamEnvironmentsDocument"),
    variables: { teamID: "team-id" },
  })
  const mutation = await runMutation(
    backendOperation("UpdateRequestDocument"),
    { requestID: "request-id", data: { title: "renamed" } }
  )()

  expect(query).toEqual(E.right(environments))
  expect(mutation).toEqual(E.right(updated))
  const [queryBody, mutationBody] = send.mock.calls.map(([, init]) =>
    JSON.parse(String(init?.body))
  )
  expect(queryBody).toMatchObject({
    query: expect.stringContaining("query GetTeamEnvironments"),
    variables: { teamID: "team-id" },
  })
  expect(mutationBody).toMatchObject({
    query: expect.stringContaining("mutation UpdateRequest"),
    variables: { requestID: "request-id", data: { title: "renamed" } },
  })
})
