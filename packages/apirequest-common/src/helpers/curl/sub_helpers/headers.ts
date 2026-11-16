import { HoppRESTHeader } from "@apirequest/data";
import * as A from "fp-ts/Array";
import { flow, pipe } from "fp-ts/function";
import * as O from "fp-ts/Option";
import * as S from "fp-ts/string";
import parser from "yargs-parser";
import { objHasArrayProperty, objHasProperty } from "~/helpers/functional/object";
import { tupleToRecord } from "~/helpers/functional/record";

const getHeaderPair = flow(
  S.replace(":", ": "),
  S.split(": "),
  // must have a key and a value
  O.fromPredicate((arr) => arr.length === 2),
  O.map(([k, v]) => [k.trim(), v?.trim() ?? ""] as [string, string])
)

export function getHeaders(parsedArguments: parser.Arguments) {
  let headers: Record<string, string> = {}

  headers = pipe(
    parsedArguments,
    // make it an array if not already
    O.fromPredicate(objHasProperty("H", "string")),
    O.map((args) => [args.H]),
    O.alt(() =>
      pipe(
        parsedArguments,
        O.fromPredicate(objHasArrayProperty("H", "string")),
        O.map((args) => args.H)
      )
    ),
    O.map(
      flow(
        A.map(getHeaderPair),
        A.filterMap((a) => a),
        tupleToRecord
      )
    ),
    O.getOrElseW(() => ({}))
  )

  if (
    objHasProperty("A", "string")(parsedArguments) ||
    objHasProperty("user-agent", "string")(parsedArguments)
  )
    headers["User-Agent"] = parsedArguments.A ?? parsedArguments["user-agent"]

  const rawContentType =
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "content-type"
    )?.[1] ?? ""

  return {
    headers,
    rawContentType,
  }
}

export const recordToHoppHeaders = (
  headers: Record<string, string>
): HoppRESTHeader[] =>
  pipe(
    Object.keys(headers),
    A.map((key) => ({
      key,
      value: headers[key],
      active: true,
      description: "",
    })),
    A.filter(
      // multipart 由浏览器重建 boundary，其余显式 Content-Type 保留在可编辑请求头中。
      (header) =>
        !(
          header.key.toLowerCase() === "content-type" &&
          /^multipart\/form-data(?:\s*;|$)/i.test(header.value)
        )
    )
  )
