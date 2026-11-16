import { defineConfig, loadEnv, normalizePath, type Plugin } from "vite"
import { APP_INFO, META_TAGS } from "./meta"
import { viteStaticCopy as StaticCopy } from "vite-plugin-static-copy"
import generateSitemap from "vite-plugin-pages-sitemap"
import HtmlConfig from "vite-plugin-html-config"
import Vue from "@vitejs/plugin-vue"
import VueI18n from "@intlify/unplugin-vue-i18n/vite"
import Components from "unplugin-vue-components/vite"
import Icons from "unplugin-icons/vite"
import Inspect from "vite-plugin-inspect"
import { VitePWA } from "vite-plugin-pwa"
import Pages from "vite-plugin-pages"
import Layouts from "vite-plugin-vue-layouts"
import IconResolver from "unplugin-icons/resolver"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import * as path from "path"
import Unfonts from "unplugin-fonts/vite"
import ImportMetaEnv from "@import-meta-env/unplugin"
import { workbenchCapture } from "./capture/plugin"

const nativeBuild = process.env.WORKBENCH_NATIVE_BUILD === "true"
const ENV = nativeBuild
  ? process.env
  : loadEnv("development", path.resolve(__dirname, "../../"), [
      "VITE_",
      "HOPP_SINGLE_USER_MODE",
    ])
const captureEnv = nativeBuild
  ? {}
  : loadEnv(
      "development",
      path.resolve(__dirname, "../../"),
      "APIREQUEST_CAPTURE_"
    )
const captureEnabled =
  !nativeBuild &&
  ENV.HOPP_SINGLE_USER_MODE === "true" &&
  !!captureEnv.APIREQUEST_CAPTURE_EXECUTABLE &&
  !!captureEnv.APIREQUEST_CAPTURE_CA_DIR

function canonicalLocalWorkspace(): Plugin {
  return {
    name: "canonical-local-workspace",
    configureServer(server) {
      if (
        ENV.HOPP_SINGLE_USER_MODE !== "true" ||
        !URL.canParse(ENV.VITE_BASE_URL)
      )
        return

      const base = new URL(ENV.VITE_BASE_URL)
      const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"]
      if (
        !loopbackHosts.includes(base.hostname) ||
        !["http:", "https:"].includes(base.protocol)
      )
        return

      const aliases = new Set(
        loopbackHosts
          .filter((host) => host !== base.hostname)
          .map((host) => (base.port ? `${host}:${base.port}` : host))
      )

      server.middlewares.use((request, response, next) => {
        if (
          (request.method !== "GET" && request.method !== "HEAD") ||
          !request.headers.host ||
          !aliases.has(request.headers.host.toLowerCase()) ||
          !request.url?.startsWith("/") ||
          !request.headers.accept?.includes("text/html")
        ) {
          next()
          return
        }

        // 单人模式只接受配置的工作台来源。导航时统一回环别名，保留路径和查询参数。
        response.writeHead(307, {
          Location: base.origin + request.url,
          "Cache-Control": "no-store",
        })
        response.end()
      })
    },
  }
}

export default defineConfig({
  envPrefix: process.env.HOPP_ALLOW_RUNTIME_ENV ? "VITE_BUILDTIME_" : "VITE_",
  envDir: nativeBuild ? false : path.resolve(__dirname, "../../"),
  // TODO: Migrate @apirequest/data to full ESM
  define: {
    // For 'util' polyfill required by dep of '@apidevtools/swagger-parser'
    "process.env": {},
    "import.meta.env.VITE_WORKBENCH_NATIVE": JSON.stringify(nativeBuild),
    "import.meta.env.VITE_WORKBENCH_CAPTURE": JSON.stringify(
      captureEnabled || ENV.VITE_WORKBENCH_CAPTURE === "true"
    ),
    "process.platform": '"browser"',
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  publicDir: path.resolve(__dirname, "../apirequest-common/public"),
  build: {
    sourcemap: !nativeBuild,
    emptyOutDir: true,
    rollupOptions: {
      maxParallelFileOps: 2,
    },
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      // Config files
      "tailwind.config.cjs": path.resolve(
        __dirname,
        "../apirequest-common/tailwind.config.cjs"
      ),
      "postcss.config.cjs": path.resolve(
        __dirname,
        "../apirequest-common/postcss.config.cjs"
      ),

      // TODO: Maybe leave ~ only for individual apps and not use on common
      // Common package aliases
      "~": path.resolve(__dirname, "../apirequest-common/src"),
      "@apirequest/common": "@apirequest/common/src",

      // Common (shared) modules (legacy - TODO: migrate these to @common/*)
      "@composables": path.resolve(
        __dirname,
        "../apirequest-common/src/composables"
      ),
      "@modules": path.resolve(__dirname, "../apirequest-common/src/modules"),
      "@services": path.resolve(__dirname, "../apirequest-common/src/services"),
      "@components": path.resolve(
        __dirname,
        "../apirequest-common/src/components"
      ),
      "@helpers": path.resolve(__dirname, "../apirequest-common/src/helpers"),
      "@platform": path.resolve(__dirname, "../apirequest-common/src/platform"),
      "@functional": path.resolve(
        __dirname,
        "../apirequest-common/src/helpers/functional"
      ),
      "@workers": path.resolve(__dirname, "../apirequest-common/src/workers"),

      // Application layer
      "@app/platform": path.resolve(__dirname, "./src/platform"),
      "@app/services": path.resolve(__dirname, "./src/services"),
      "@app/components": path.resolve(__dirname, "./src/components"),
      "@app/composables": path.resolve(__dirname, "./src/composables"),
      "@app/helpers": path.resolve(__dirname, "./src/helpers"),
      "@app/api": path.resolve(__dirname, "./src/api"),

      // Node.js polyfills
      stream: "stream-browserify",
      util: "util",
      querystring: "qs",
    },
    dedupe: ["vue"],
  },
  plugins: [
    captureEnabled &&
      workbenchCapture(
        ENV.VITE_BASE_URL,
        ENV.VITE_BACKEND_GQL_URL,
        captureEnv.APIREQUEST_CAPTURE_EXECUTABLE,
        captureEnv.APIREQUEST_CAPTURE_CA_DIR
      ),
    nativeBuild && {
      name: "workbench-native-entry",
      load(id) {
        const file = normalizePath(id.split("?")[0])
        const commonBackend = normalizePath(
          path.resolve(__dirname, "../apirequest-common/src/helpers/backend")
        )
        const webGenerated = normalizePath(
          path.resolve(__dirname, "./src/api/generated")
        )
        // 也约束已生成过网页版文件的开发机，避免本地构建掩盖原生依赖。
        if (
          file === `${commonBackend}/graphql.ts` ||
          file === `${commonBackend}/backend-schema.json` ||
          file.startsWith(`${webGenerated}/`)
        ) {
          this.error(
            `Native frontend cannot import web GraphQL output: ${file}`
          )
        }
      },
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace('src="/src/main.ts"', 'src="/src/native.ts"'),
      },
    },
    canonicalLocalWorkspace(),
    Inspect(), // go to url -> /__inspect
    HtmlConfig({
      metas: META_TAGS(ENV),
    }),
    Vue(),
    Pages({
      routeStyle: "nuxt",
      dirs: ["../apirequest-common/src/pages", "./src/pages"],
      importMode: "async",
      exclude: nativeBuild
        ? ["**/__tests__/**", "access-tokens.vue", "view/**"]
        : ["**/__tests__/**"],
      onRoutesGenerated(routes) {
        if (nativeBuild) return
        generateSitemap({
          routes,
          nuxtStyle: true,
          allowRobots: true,
          dest: ".sitemap-gen",
          hostname: ENV.VITE_BASE_URL,
        })
      },
    }),
    !nativeBuild &&
      StaticCopy({
        targets: [
          {
            src: normalizePath(path.resolve(__dirname, "./.sitemap-gen/*")),
            dest: ".",
          },
        ],
      }),
    Layouts({
      layoutsDirs: "../apirequest-common/src/layouts",
      defaultLayout: "default",
    }),
    VueI18n({
      runtimeOnly: false,
      compositionOnly: true,
      include: [path.resolve(__dirname, "locales")],
    }),
    Components({
      dts: nativeBuild ? false : "../apirequest-common/src/components.d.ts",
      dirs: ["../apirequest-common/src/components"],
      directoryAsNamespace: true,
      resolvers: [
        IconResolver({
          prefix: "icon",
          customCollections: ["hopp", "auth", "brands"],
        }),
        (compName: string) => {
          if (compName.startsWith("Hopp"))
            return { name: compName, from: "@apirequest/ui" }
          else return undefined
        },
      ],
      types: [
        {
          from: "vue-tippy",
          names: ["Tippy"],
        },
      ],
    }),
    Icons({
      compiler: "vue3",
      customCollections: {
        hopp: FileSystemIconLoader("../apirequest-common/assets/icons"),
        auth: FileSystemIconLoader("../apirequest-common/assets/icons/auth"),
        brands: FileSystemIconLoader(
          "../apirequest-common/assets/icons/brands"
        ),
      },
    }),
    VitePWA({
      // 桌面资源随安装包升级，禁用浏览器的离线缓存避免载入旧版界面。
      disable: nativeBuild,
      useCredentials: true,
      manifest: {
        name: APP_INFO.name,
        short_name: APP_INFO.name,
        description: APP_INFO.shortDescription,
        start_url: "/?source=pwa",
        id: "/?source=pwa",
        protocol_handlers: [
          {
            protocol: "web+apirequest",
            url: "/%s",
          },
          {
            protocol: "web+hopp",
            url: "/%s",
          },
        ],
        background_color: APP_INFO.app.background,
        theme_color: APP_INFO.app.background,
        icons: [
          {
            src: "/icons/pwa-16x16.png",
            sizes: "16x16",
            type: "image/png",
          },
          {
            src: "/icons/pwa-32x32.png",
            sizes: "32x32",
            type: "image/png",
          },
          {
            src: "/icons/pwa-128x128.png",
            sizes: "128x128",
            type: "image/png",
          },
          {
            src: "/icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/pwa-256x256.png",
            sizes: "256x256",
            type: "image/png",
          },
          {
            src: "/icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/pwa-1024x1024.png",
            sizes: "1024x1024",
            type: "image/png",
          },
        ],
      },
      registerType: "prompt",
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 15728640, // 15 MB
        navigateFallbackDenylist: [
          /robots.txt/,
          /sitemap.xml/,
          /discord/,
          /telegram/,
          /beta/,
          /careers/,
          /newsletter/,
          /twitter/,
          /github/,
          /announcements/,
          /admin/,
          /backend/,
        ],
      },
    }),
    Unfonts({
      fontsource: {
        families: [
          {
            name: "Inter Variable",
            variables: ["variable-full"],
          },
          {
            name: "Material Symbols Rounded Variable",
            variables: ["variable-full"],
          },
          {
            name: "Roboto Mono Variable",
            variables: ["variable-full"],
          },
        ],
      },
    }),
    process.env.HOPP_ALLOW_RUNTIME_ENV
      ? ImportMetaEnv.vite({
          example: "../../.env.example",
          env: "../../.env",
        })
      : [],
  ],
})
