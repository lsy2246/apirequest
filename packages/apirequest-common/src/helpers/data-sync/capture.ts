import { captureAPI } from "~/helpers/workbench-capture";
import { type Entry } from "./model";

async function command<T>(action: string, input: object = {}): Promise<T> {
  try {
    return await captureAPI<T>("/capture_api", { action, input })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "busy")
      throw new Error("抓包会话仍在写入，请结束该会话后再导入或同步")
    if (code === "transfer_too_large")
      throw new Error("抓包数据超过 64 MB，请先单独归档较大的会话")
    throw new Error("无法读取或写入抓包数据，请确认抓包服务可用后重试")
  }
}
export async function snapshotCapture(): Promise<Entry[]> {
  return command<Entry[]>("data_export")
}
export async function importCapture(entries: Entry[], dryRun: boolean) {
  if (entries.length) await command("data_import", { entries, dryRun })
}
