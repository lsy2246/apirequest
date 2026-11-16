import type { HoppRESTParam, HoppRESTRequest } from "@apirequest/data";

const queryDelimiters = (url: string) => {
  const delimiters = [...url.matchAll(/<<[^>]*>>|[?#]/g)]
  const hash = delimiters.find(([token]) => token === "#")?.index ?? url.length
  const question = delimiters.find(([token]) => token === "?")?.index ?? hash
  return { hash, query: Math.min(question, hash) }
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "))
  } catch {
    return value
  }
}

const encode = (value: string) =>
  value
    .split(/(<<[^>]*>>)/)
    .map((part, index) => (index % 2 ? part : encodeURIComponent(part)))
    .join("")

export function splitRequestQuery(url: string) {
  const { query, hash } = queryDelimiters(url)
  const params: HoppRESTParam[] = url
    .slice(query + 1, hash)
    .split(/(<<[^>]*>>)|&/)
    .reduce<string[]>(
      (parts, part, index) => {
        if (index % 2) {
          if (part) parts[parts.length - 1] += part
          else parts.push("")
        } else {
          parts[parts.length - 1] += part
        }
        return parts
      },
      [""]
    )
    .filter(Boolean)
    .map((entry) => {
      const separator = [...entry.matchAll(/<<[^>]*>>|=/g)].find(
        ([token]) => token === "="
      )?.index
      return {
        key: decode(
          separator === undefined ? entry : entry.slice(0, separator)
        ),
        value:
          separator === undefined ? "" : decode(entry.slice(separator + 1)),
        active: true,
        description: "",
      }
    })
    .filter(({ key }) => key !== "")
  return { endpoint: url.slice(0, query) + url.slice(hash), params }
}

export function formatRequestQuery({
  endpoint,
  params,
  queryEncoding,
}: HoppRESTRequest) {
  const query = params
    .filter((param) => param.active && param.key)
    .map(
      ({ key, value }) =>
        `${encode(key)}=${queryEncoding === false ? value : encode(value)}`
    )
    .join("&")
  if (!query) return endpoint
  const { query: existing, hash } = queryDelimiters(endpoint)
  const beforeHash = endpoint.slice(0, hash)
  const separator =
    existing === hash ? "?" : /[?&]$/.test(beforeHash) ? "" : "&"
  return beforeHash + separator + query + endpoint.slice(hash)
}
