import { IHTMLTag } from "vite-plugin-html-config"

export const APP_INFO = {
  name: "API Request",
  shortDescription: "开源 API 开发生态",
  description:
    "帮助你更快地创建请求，节省宝贵的开发时间。",
  keywords:
    "apirequest, api, request, testing, tool, rest, websocket, sse, graphql, socketio, mqtt",
  app: {
    background: "#181818",
    lightThemeColor: "#ffffff",
    darkThemeColor: "#181818",
  },
} as const

export const META_TAGS = (env: Record<string, string>): IHTMLTag[] => [
  {
    name: "keywords",
    content: APP_INFO.keywords,
  },
  {
    name: "X-UA-Compatible",
    content: "IE=edge, chrome=1",
  },
  {
    name: "name",
    content: `${APP_INFO.name} • ${APP_INFO.shortDescription}`,
  },
  {
    name: "description",
    content: APP_INFO.description,
  },
  {
    name: "image",
    content: `${env.VITE_BASE_URL}/banner.png`,
  },
  // Open Graph tags
  {
    name: "og:title",
    content: `${APP_INFO.name} • ${APP_INFO.shortDescription}`,
  },
  {
    name: "og:description",
    content: APP_INFO.description,
  },
  {
    name: "og:image",
    content: `${env.VITE_BASE_URL}/banner.png`,
  },
  // Twitter tags
  {
    name: "twitter:card",
    content: "summary_large_image",
  },
  {
    name: "twitter:title",
    content: `${APP_INFO.name} • ${APP_INFO.shortDescription}`,
  },
  {
    name: "twitter:description",
    content: APP_INFO.description,
  },
  {
    name: "twitter:image",
    content: `${env.VITE_BASE_URL}/banner.png`,
  },
  // Add to homescreen for Chrome on Android. Fallback for PWA (handled by nuxt)
  {
    name: "application-name",
    content: APP_INFO.name,
  },
  // Windows phone tile icon
  {
    name: "msapplication-TileImage",
    content: `${env.VITE_BASE_URL}/icon.png`,
  },
  {
    name: "msapplication-TileColor",
    content: APP_INFO.app.background,
  },
  {
    name: "msapplication-tap-highlight",
    content: "no",
  },
  // iOS Safari
  {
    name: "apple-mobile-web-app-title",
    content: APP_INFO.name,
  },
  {
    name: "apple-mobile-web-app-capable",
    content: "yes",
  },
  {
    name: "apple-mobile-web-app-status-bar-style",
    content: "black-translucent",
  },
  // PWA
  {
    name: "theme-color",
    content: APP_INFO.app.darkThemeColor,
    media: "(prefers-color-scheme: dark)",
  },
  {
    name: "theme-color",
    content: APP_INFO.app.lightThemeColor,
    media: "(prefers-color-scheme: light)",
  },
  {
    name: "supported-color-schemes",
    content: "light dark",
  },
  {
    name: "mask-icon",
    content: "/icon.png",
    color: APP_INFO.app.background,
  },
]
