import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [preact()],
	// The release of an image build, to tell an old tab from a new server (R-099).
	define: {
		__APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || "dev"),
	},
	server: {
		proxy: {
			"/healthz": "http://localhost:8080",
			"/ws": { target: "ws://localhost:8080", ws: true },
		},
	},
	test: { environment: "jsdom", exclude: ["e2e/**", "node_modules/**"] },
});
