import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
      },
    }),
  ],
  base: "./",
  worker: { format: "es" },
  // tokens.json lives in ../replica/design, outside the app folder
  server: { fs: { allow: [".."] } },
});
