import type { HoppRESTRequest } from "@apirequest/data";

// A cURL command updates the wire request; the API's identity and documentation
// still belong to the request that is open in the editor.
export function mergeCurlRequest(
  current: HoppRESTRequest,
  imported: HoppRESTRequest
): HoppRESTRequest {
  return {
    ...current,
    endpoint: imported.endpoint,
    method: imported.method,
    auth: imported.auth,
    body: imported.body,
    curlOptions: imported.curlOptions,
    params: imported.params.map((param) => ({
      ...param,
      description:
        current.params.find((previous) => previous.key === param.key)
          ?.description ?? param.description,
    })),
    headers: imported.headers.map((header) => ({
      ...header,
      description:
        current.headers.find(
          (previous) => previous.key.toLowerCase() === header.key.toLowerCase()
        )?.description ?? header.description,
    })),
  }
}
