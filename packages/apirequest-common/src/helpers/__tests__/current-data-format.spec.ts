import { describe, expect, it } from "vitest"
import { SELECTED_ENV_INDEX_SCHEMA } from "~/services/persistence/validation-schemas"
import {
  HoppRESTRequest,
  HoppGQLRequest,
  HoppCollection,
  Environment,
  GlobalEnvironment,
  getDefaultRESTRequest,
  getDefaultGQLRequest,
  makeCollection,
} from "@apirequest/data"

describe("current data formats", () => {
  it("rejects the retired team environment selection", () => {
    expect(
      SELECTED_ENV_INDEX_SCHEMA.safeParse({ type: "NO_ENV_SELECTED" }).success
    ).toBe(true)
    expect(
      SELECTED_ENV_INDEX_SCHEMA.safeParse({
        type: "TEAM_ENV",
        teamID: "old",
        teamEnvID: "old",
        environment: { v: 2, id: "old", name: "old", variables: [] },
      }).success
    ).toBe(false)
  })
  it("accepts current requests and rejects old versions", () => {
    const rest = getDefaultRESTRequest(),
      gql = getDefaultGQLRequest()
    expect(rest.endpoint).toBe("")
    expect(gql.url).toBe("")
    expect(gql.query).toBe("")
    expect(gql.variables).toBe("{}")
    expect(HoppRESTRequest.safeParse(rest).type).toBe("ok")
    expect(HoppGQLRequest.safeParse(gql).type).toBe("ok")
    expect(HoppRESTRequest.safeParse({ ...rest, v: "16" }).type).not.toBe("ok")
    expect(HoppGQLRequest.safeParse({ ...gql, v: 9 }).type).not.toBe("ok")
    expect(
      HoppRESTRequest.safeParse({ name: "old", method: "GET" }).type
    ).not.toBe("ok")
  })
  it("accepts mixed current collections and rejects old collection or environment versions", () => {
    const coll = makeCollection({
      name: "fixture",
      folders: [],
      requests: [getDefaultRESTRequest(), getDefaultGQLRequest()],
      auth: { authType: "inherit", authActive: true },
      headers: [],
      variables: [],
      description: null,
      preRequestScript: "",
      testScript: "",
    })
    expect(HoppCollection.safeParse(coll).type).toBe("ok")
    expect(HoppCollection.safeParse({ ...coll, v: 11 }).type).not.toBe("ok")
    expect(
      Environment.safeParse({
        v: 2,
        id: "fixture",
        name: "fixture",
        variables: [],
      }).type
    ).toBe("ok")
    expect(
      Environment.safeParse({ v: 1, name: "old", variables: [] }).type
    ).not.toBe("ok")
    expect(GlobalEnvironment.safeParse({ v: 2, variables: [] }).type).toBe("ok")
    expect(GlobalEnvironment.safeParse({ v: 1, variables: [] }).type).not.toBe(
      "ok"
    )
  })
})
