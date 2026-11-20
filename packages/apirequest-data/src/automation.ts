import { z } from "zod"
import { CaseMapSchema } from "./request-case"

/** Shared defaults and limits for saved automation plans and their runners. */
export const AutomationConfigSchema = z
  .object({
    iterations: z.number().int().min(1).max(1000).default(1),
    delay: z.number().int().min(0).max(60000).default(0),
    stopOnError: z.boolean().default(false),
    persistResponses: z.boolean().default(true),
    keepVariableValues: z.boolean().default(false),
    executeScripts: z.boolean().default(true),
    // Saved case definitions travel with the plan so background runs do not
    // depend on an open browser. Omitted on legacy request-only plans.
    requestCases: CaseMapSchema.optional(),
    selectedCaseIDs: z.array(z.string()).optional(),
    selectedRequestIDs: z.array(z.string()).optional(),
    casesOnly: z.boolean().optional(),
    webhook: z
      .object({
        enabled: z.boolean().default(false),
        includeErrorDetails: z.boolean().default(false),
        channelIDs: z.array(z.string().min(1).max(200)).max(50).optional(),
      })
      .strict()
      .refine(
        (value) =>
          !value.enabled ||
          value.channelIDs === undefined ||
          value.channelIDs.length > 0,
        "Select at least one notification channel"
      )
      .optional(),
  })
  .strict()

export type AutomationConfig = z.infer<typeof AutomationConfigSchema>

export function getAutomationConfig(
  config: Partial<AutomationConfig> = {},
  legacyDefaults: Partial<AutomationConfig> = {}
): AutomationConfig {
  const normalized = { ...legacyDefaults, ...config }
  // Earlier previews stored a plan-level timeout. It no longer participates
  // in execution; keep existing plans readable while dropping that setting.
  delete (normalized as Record<string, unknown>).caseTimeoutMs
  return AutomationConfigSchema.parse(normalized)
}
