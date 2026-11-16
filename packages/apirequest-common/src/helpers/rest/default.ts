import { getDefaultRESTRequest as createDefaultRESTRequest, HoppRESTRequest } from "@apirequest/data";

export const getDefaultRESTRequest = (): HoppRESTRequest => {
  // Draft references are assigned when saving; keep the shared default fields.
  const { _ref_id: _refID, ...request } = createDefaultRESTRequest()
  return request
}
