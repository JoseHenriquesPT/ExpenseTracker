import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local-first personal app: no backend. `npm run dev` to develop,
// `npm run build` + `npm run preview` to run the production bundle locally.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
});
