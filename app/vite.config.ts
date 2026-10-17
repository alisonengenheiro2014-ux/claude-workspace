import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // tokens.json lives in ../replica/design, outside the app folder
  server: { fs: { allow: [".."] } },
});
