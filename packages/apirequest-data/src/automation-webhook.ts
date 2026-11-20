import { z } from "zod"

export function getAutomationWebhookFormat(url: string): "feishu" | "json" {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname === "open.feishu.cn" &&
      /^\/open-apis\/bot\/v2\/hook\/[^/]+\/?$/.test(parsed.pathname)
    )
      return "feishu"
  } catch {
    // A draft URL may still be incomplete while the user is typing.
  }
  return "json"
}

const text = z.string().max(8192)
const errorSchema = z.object({ code: text, data: z.unknown().optional() })

// Only report data is accepted here: credentials, responses and recovery
// snapshots never need to travel from the browser to the notification sender.
export const AutomationWebhookReportSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("automation"),
  name: text,
  createdAt: z.string().datetime(),
  environmentID: z.string().nullable().optional(),
  environmentName: text.optional(),
  summary: z.object({
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    elapsedMs: z.number().finite().nonnegative(),
  }),
  automation: z.object({
    status: z.enum(["completed", "error"]),
    totalRequests: z.number().int().nonnegative().optional(),
    passedTests: z.number().int().nonnegative(),
    failedTests: z.number().int().nonnegative(),
    totalTests: z.number().int().nonnegative(),
  }),
  errorDetails: z.array(errorSchema).max(100).optional(),
  steps: z
    .array(
      z.object({
        name: text,
        requestName: text.optional(),
        method: text.optional(),
        iteration: z.number().int().optional(),
        passed: z.boolean(),
        elapsedMs: z.number().finite().nonnegative().optional(),
        statusCode: z.number().int().optional(),
        errors: z.array(text),
        errorDetails: z.array(errorSchema).optional(),
        assertions: z
          .array(
            z.object({
              descriptor: text,
              passed: z.number(),
              failed: z.number(),
              expectResults: z.array(z.object({ status: text, message: text })),
            })
          )
          .optional(),
      })
    )
    .max(100000),
})
