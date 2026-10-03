import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The console is served by the runtime itself. In development, `vite` proxies
// the API to a runtime started with `jamot start` on :3000.
export default defineConfig({
	plugins: [react()],
	build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
	server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3000" } },
});
