import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// transformers.js loads the ONNX runtime (.wasm, up to 28 MB) from the
// jsDelivr CDN at run time. The copy Vite would emit is never used, and it
// is over Cloudflare Pages' 25 MB per-file limit, so it is left out.
const dropOrtWasm: Plugin = {
  name: "drop-ort-wasm",
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
  },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dropOrtWasm,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon.png"],
      manifest: {
        name: "Editor",
        short_name: "Editor",
        description: "Editor de vídeo pessoal que roda no iPhone.",
        lang: "pt-BR",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0a0a0c",
        theme_color: "#0a0a0c",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // the speech-recognition runtime, kept after the first use (the
        // models themselves are cached by transformers.js)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@/,
            handler: "CacheFirst",
            options: { cacheName: "ort-runtime", expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  base: "./",
  worker: { format: "es" },
  // tokens.json lives in ../replica/design, outside the app folder
  server: { fs: { allow: [".."] } },
});
