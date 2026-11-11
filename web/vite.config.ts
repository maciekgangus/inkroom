import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [preact()],
	server: {
		proxy: {
			"/healthz": "http://localhost:8080",
			"/ws": { target: "ws://localhost:8080", ws: true },
		},
	},
	test: { environment: "jsdom", exclude: ["e2e/**", "node_modules/**"] },
});
