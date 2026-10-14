import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Hosted household app (Supabase + sign-in). The PWA config makes it
// installable to a phone home screen and runs it fullscreen ("standalone").
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate", // new deploys self-update on next load
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Expense Tracker",
        short_name: "Expenses",
        description: "Private household expense tracker",
        theme_color: "#0f1220",
        background_color: "#0f1220",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  server: { port: 5173, open: true },
});
