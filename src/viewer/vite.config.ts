import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createViewerApi } from "./server.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    tailwindcss(),
    {
      name: "viewer-api",
      configureServer(server) {
        server.middlewares.use(
          createViewerApi(
            fileURLToPath(new URL("../../runs", import.meta.url)),
          ),
        );
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
