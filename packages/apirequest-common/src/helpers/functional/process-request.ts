import type { RelayRequest } from "@apirequest/kernel"
import * as E from "fp-ts/Either"
import { pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import { cloneDeep } from "lodash-es"
import superjson from "superjson"

import { settingsStore } from "~/newstore/settings"

const isEncoded = (value: string): boolean =>
  pipe(
    E.tryCatch(
      () => value !== decodeURIComponent(value),
      () => false
    ),
    E.getOrElse(() => false)
  )

const encodeParam = (value: string): string =>
  pipe(
    O.some(value),
    O.filter((v) => !isEncoded(v)),
    O.map(encodeURIComponent),
    O.getOrElse(() => value)
  )

const processParams = (
  params: [string, string][],
  encodeMode = settingsStore.value.ENCODE_MODE
): [string, string][] => {
  const needsEncoding = (v: string) =>
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/.test(v)

  return params.map(([key, value]) => {
    const isEncodingRequired =
      encodeMode === "enable" || (encodeMode === "auto" && needsEncoding(value))

    const encodedValue = isEncodingRequired ? encodeParam(value) : value

    return [key, encodedValue]
  })
}

const buildQueryString = (params: [string, string][]): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${v}`).join("&")

const combineWithExistingSearch = (urlObj: URL, queryString: string): URL => {
  const existingSearch =
    urlObj.search.length > 1 ? urlObj.search.substring(1) : ""

  urlObj.search = pipe(
    existingSearch,
    O.fromPredicate((s) => s.length > 0),
    O.map((s) => `${s}&${queryString}`),
    O.getOrElse(() => queryString)
  )

  return urlObj
}

const updateUrl = (
  url: string,
  params: [string, string][],
  encodeMode?: "enable" | "disable" | "auto"
): E.Either<Error, string> =>
  pipe(
    E.tryCatch(
      () => new URL(url),
      (e) => new Error(`Invalid URL: ${e}`)
    ),
    E.map((urlObj) => {
      const processedParams = processParams(params, encodeMode)

      if (processedParams.length > 0) {
        const queryString = buildQueryString(processedParams)
        return combineWithExistingSearch(urlObj, queryString)
      }

      return urlObj
    }),
    E.map((u) => u.toString())
  )

export const preProcessRelayRequest = (
  req: RelayRequest,
  encodeMode?: "enable" | "disable" | "auto"
): RelayRequest =>
  pipe(cloneDeep(req), (req) =>
    Array.isArray(req.params) && req.params.length > 0
      ? pipe(
          updateUrl(req.url, req.params, encodeMode),
          E.map((url) => ({ ...req, url, params: {} })),
          E.getOrElse(() => req)
        )
      : Array.isArray(req.params)
        ? { ...req, params: {} }
        : req
  )

export const postProcessRelayRequest = (req: RelayRequest): RelayRequest => {
  const result = pipe(cloneDeep(req), (req) => superjson.serialize(req).json)

  return result
}
