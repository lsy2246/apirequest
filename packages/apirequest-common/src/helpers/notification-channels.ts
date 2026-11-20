export type NotificationChannel = {
  id: string
  name: string
  format: "json" | "feishu"
  enabled: boolean
  url: string
  hasSecret: boolean
  legacy?: boolean
}
export type NotificationDelivery = {
  status: "pending" | "sent" | "failed" | "skipped" | "partial"
  attempts: number
  error?: string
  channels?: {
    channelID: string
    name: string
    status: "pending" | "sent" | "failed" | "skipped"
    attempts: number
    error?: string
  }[]
}
