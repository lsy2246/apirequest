import { defineConfig } from "vite"
import { cpSync, mkdirSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
const source = fileURLToPath(new URL(".", import.meta.url))
const destination = fileURLToPath(new URL("../capture-dist/", import.meta.url))
export default defineConfig({
  publicDir: false,
  build: {
    ssr: new URL("./server.ts", import.meta.url).pathname,
    outDir: destination,
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
  plugins: [
    {
      name: "capture-engine",
      closeBundle() {
        mkdirSync(destination + "engine", { recursive: true })
        for (const file of readdirSync(source))
          if (file.endsWith(".py"))
            cpSync(source + file, destination + "engine/" + file)
      },
    },
  ],
})
