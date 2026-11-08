import { defineConfig } from "vite";

// Static site for Cloudflare Pages. No VITE_* variables are read.
export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        credits: "credits.html",
      },
    },
  },
});
