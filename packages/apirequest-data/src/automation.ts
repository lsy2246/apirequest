import { z } from "zod"

/** Shared defaults and limits for saved automation plans and their runners. */
export const AutomationConfigSchema = z
  .object({
    iterations: z.number().int().min(1).max(1000).default(1),
    delay: z.number().int().min(0).max(60000).default(0),
    stopOnError: z.boolean().default(false),
    persistResponses: z.boolean().default(true),
    keepVariableValues: z.boolean().default(false),
    executeScripts: z.boolean().default(true),
  })
  .strict()

export type AutomationConfig = z.infer<typeof AutomationConfigSchema>

export function getAutomationConfig(
  config: Partial<AutomationConfig> = {},
  legacyDefaults: Partial<AutomationConfig> = {}
): AutomationConfig {
  return AutomationConfigSchema.parse({
    ...legacyDefaults,
    ...config,
  })
}
