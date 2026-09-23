import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built site works from any GitHub Pages path.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
