import { serviceLimitMessage } from "~/helpers/service-limit-error"
import {
  body,
  type RelayError,
  type RelayRequest,
  type RelayResponse,
  type RelayCapabilities,
} from "@apirequest/kernel"
import { markRaw } from "vue"
import { BrowserKernelInterceptorService } from "@apirequest/common/platform/std/kernel-interceptors/browser"
import { KernelInterceptorNativeStore } from "@apirequest/common/platform/std/kernel-interceptors/native/store"
import SettingsNative from "@apirequest/common/components/settings/Native.vue"
import type { getI18n } from "@apirequest/common/modules/i18n"
import {
  def as webAuth,
  renewLocalWorkspaceSession,
} from "@app/platform/auth/web"
import * as E from "fp-ts/Either"

const RELAY_CONTENT_TYPE = "application/x-workbench-relay"

type RelayResult = {
  status: RelayResponse["status"]
  statusText: string
  headers: Record<string, string>
}

export class WorkbenchBrowserInterceptor extends BrowserKernelInterceptorService {
  private readonly settings = this.bind(KernelInterceptorNativeStore)
  public readonly settingsEntry = markRaw({
    title: (t: ReturnType<typeof getI18n>) =>
      t("interceptor.native.settings_title"),
    component: SettingsNative,
  })
  public readonly capabilities = {
    method: new Set([
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ]),
    header: new Set(["stringvalue"]),
    content: new Set([
      "text",
      "json",
      "xml",
      "form",
      "multipart",
      "urlencoded",
    ]),
    auth: new Set(["basic", "bearer", "apikey"]),
    security: new Set([
      "clientcertificates",
      "cacertificates",
      "certificatevalidation",
      "hostverification",
      "peerverification",
    ]),
    proxy: new Set([
      "http",
      "https",
      "socks",
      "authentication",
      "certificates",
    ]),
    advanced: new Set(["redirects", "timeout", "localaccess"]),
  } satisfies RelayCapabilities

  protected override executeRelay(request: RelayRequest) {
    const target = URL.canParse(request.url) ? new URL(request.url) : undefined
    if (
      webAuth.localSessionState?.value !== "ready" ||
      !target ||
      !["http:", "https:"].includes(target.protocol) ||
      target.origin === window.location.origin
    ) {
      return super.executeRelay(request)
    }

    // 发送前确定通道，避免有副作用的请求因网络错误被重复提交。
    const controller = new AbortController()
    return {
      cancel: async () => controller.abort(),
      response: this.sendConfiguredRequest(request, controller.signal),
    }
  }

  private async sendConfiguredRequest(
    request: RelayRequest,
    signal: AbortSignal
  ) {
    try {
      await this.settings.whenReady()
      signal.throwIfAborted()
      const effective = this.settings.completeRequest(request)
      effective.meta = {
        ...effective.meta,
        ...request.meta,
        options: { ...effective.meta?.options, ...request.meta?.options },
      }
      return sendLocal(effective, signal)
    } catch (error) {
      return E.left<RelayError>({
        kind: signal.aborted ? "abort" : "network",
        message:
          error instanceof Error
            ? error.message
            : "Request settings could not be loaded",
      })
    }
  }
}

async function sendLocal(
  request: RelayRequest,
  signal: AbortSignal
): Promise<E.Either<RelayError, RelayResponse>> {
  const start = Date.now()
  try {
    const headers = new Headers(request.headers)
    const content = request.content
    let data: string | undefined
    if (content && !["GET", "HEAD"].includes(request.method)) {
      const value = content.content
      const multipart = value instanceof FormData
      const payload = new Response(
        content.kind === "json" && typeof value !== "string"
          ? JSON.stringify(value)
          : (value as BodyInit),
        multipart
          ? undefined
          : { headers: { "content-type": content.mediaType } }
      )
      const blob = await payload.blob()
      // Keep the client ceiling aligned with the largest allowed server setting.
      // The relay reports the active policy for smaller configured limits.
      if (blob.size > 64 * 1024 * 1024) {
        return E.left({
          kind: "network",
          message: "转发请求正文超过 64 MiB 硬上限。",
          cause: { localRelayStatus: 413 },
        })
      }
      if (multipart || !headers.has("content-type")) {
        headers.set("content-type", blob.type)
      }
      data = await readBase64(blob)
    }

    const upstreamHeaders: Record<string, string> = Object.create(null)
    headers.forEach((value, name) => {
      upstreamHeaders[name] = value
    })
    const requestBody = JSON.stringify({
      url: request.url,
      method: request.method,
      headers: upstreamHeaders,
      data,
      timeout: request.meta?.options?.timeout,
      followRedirects: request.meta?.options?.followRedirects,
      security: request.security && {
        verifyHost: request.security.verifyHost,
        verifyPeer: request.security.verifyPeer,
        certificates: await serializeCertificates(
          request.security.certificates
        ),
      },
      proxy: request.proxy && {
        url: request.proxy.url,
        auth: request.proxy.auth,
        certificates: await serializeCertificates(request.proxy.certificates),
      },
    })
    const relay = () =>
      fetch(`${import.meta.env.VITE_BACKEND_API_URL}/auth/local-relay`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-workbench-local": "1",
          accept: RELAY_CONTENT_TYPE,
        },
        body: requestBody,
        signal,
        redirect: "error",
      })
    let res = await relay()
    let error = res.ok ? null : await res.json().catch(() => null)
    // 目标的 401 封装在成功的转发响应内。只有本机会话鉴权拦截才允许重试。
    if (
      res.status === 401 ||
      (res.status === 403 && error?.message === "auth/cookies_not_found")
    ) {
      signal.throwIfAborted()
      await renewLocalWorkspaceSession()
      res = await relay()
      error = res.ok ? null : await res.json().catch(() => null)
    }
    if (!res.ok) {
      if (res.status === 504)
        return E.left({ kind: "timeout", message: "Target request timed out" })
      const message = serviceLimitMessage(res.status, error, res.headers.get("Retry-After"))
      if (res.status === 413 || res.status === 429 || res.status === 503) {
        return E.left({
          kind: "network",
          message: message ?? `Local relay HTTP ${res.status}`,
          cause: { localRelayStatus: res.status },
        })
      }
      return E.left({
        kind: error?.kind === "certificate" ? "certificate" : "network",
        message: message ?? `Local relay HTTP ${res.status}`,
        cause:
          typeof error?.message === "string" ? error.message : res.statusText,
      })
    }

    const { result, bytes } = await readRelayResult(res)
    const headerSize = new TextEncoder().encode(
      JSON.stringify(result.headers)
    ).byteLength
    return E.right({
      id: request.id,
      status: result.status,
      statusText: result.statusText,
      version: "HTTP/1.1",
      headers: result.headers,
      body: body.body(bytes, result.headers["content-type"]),
      meta: {
        timing: { start, end: Date.now() },
        size: {
          headers: headerSize,
          body: bytes.byteLength,
          total: headerSize + bytes.byteLength,
        },
      },
    })
  } catch (error) {
    if (signal.aborted)
      return E.left({ kind: "abort", message: "Request cancelled" })
    return E.left({
      kind: "network",
      message: "Local relay request failed",
      cause: error instanceof Error ? error.message : undefined,
    })
  }
}

async function serializeCertificates(
  certificates?: NonNullable<RelayRequest["security"]>["certificates"]
) {
  if (!certificates) return undefined
  const client = certificates.client
  return {
    ca:
      certificates.ca &&
      (await Promise.all(
        certificates.ca.map((bytes: Uint8Array) =>
          readBase64(new Blob([new Uint8Array(bytes)]))
        )
      )),
    client:
      client?.kind === "pem"
        ? {
            kind: "pem",
            cert: await readBase64(new Blob([new Uint8Array(client.cert)])),
            key: await readBase64(new Blob([new Uint8Array(client.key)])),
          }
        : client?.kind === "pfx"
          ? {
              kind: "pfx",
              data: await readBase64(new Blob([new Uint8Array(client.data)])),
              password: client.password,
            }
          : undefined,
  }
}

async function readRelayResult(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]
  if (contentType !== RELAY_CONTENT_TYPE)
    throw new Error("Unexpected local relay response format")

  const payload = new Uint8Array(await response.arrayBuffer())
  const separator = payload.indexOf(10)
  if (separator < 0) throw new Error("Invalid local relay response")
  const result = JSON.parse(
    new TextDecoder().decode(payload.subarray(0, separator))
  ) as RelayResult
  return { result, bytes: payload.subarray(separator + 1) }
}

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
