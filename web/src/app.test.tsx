import { render } from "preact";
import { expect, test } from "vitest";
import { App } from "./app";

test("App mounts an empty canvas", () => {
	const root = document.createElement("div");
	render(<App />, root);

	const canvas = root.querySelector("canvas");
	expect(canvas).not.toBeNull();
});
