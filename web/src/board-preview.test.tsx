import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as api from "./api";
import { BoardPreview } from "./board-preview";
import { forgetPreviews, setPreview } from "./preview-cache";

vi.mock("./api", () => ({
	boardPreview: vi.fn(),
	boardPreviewPicture: vi.fn(),
	storePreviewPicture: vi.fn(() => Promise.resolve()),
}));
vi.mock("./board/preview", () => ({
	renderPreview: vi.fn(() => "data:image/png;base64,NEW"),
}));

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("BoardPreview (R-052, R-080)", () => {
	let root: HTMLElement;
	const img = () =>
		root.querySelector("img.preview") as HTMLImageElement | null;

	beforeEach(() => {
		localStorage.clear();
		forgetPreviews();
		vi.mocked(api.boardPreview).mockReset();
		vi.mocked(api.boardPreviewPicture).mockReset();
		vi.mocked(api.boardPreviewPicture).mockResolvedValue(null); // none stored by default
		vi.mocked(api.storePreviewPicture).mockClear();
		vi.stubGlobal("IntersectionObserver", undefined); // loads at once
		root = document.createElement("div");
	});
	afterEach(() => {
		act(() => render(null, root));
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	test("a board seen before shows its last picture at once, before the server has answered", () => {
		setPreview("b1", '"1"', "data:image/png;base64,OLD");
		vi.mocked(api.boardPreview).mockReturnValue(new Promise(() => {}));
		act(() => render(<BoardPreview boardId="b1" />, root));
		expect(img()?.src).toBe("data:image/png;base64,OLD");
	});

	test("when the board has changed, the new picture replaces the old one", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		setPreview("b1", '"1"', "data:image/png;base64,OLD");
		vi.setSystemTime(Date.now() + 60_000); // not checked recently
		vi.mocked(api.boardPreview).mockResolvedValue({
			etag: '"2"',
			data: { background: "plain", strokes: [] },
		});
		act(() => render(<BoardPreview boardId="b1" />, root));
		await flush();
		expect(img()?.src).toBe("data:image/png;base64,NEW");
	});

	test("an unchanged board keeps its picture and is not drawn again", async () => {
		const { renderPreview } = await import("./board/preview");
		vi.mocked(renderPreview).mockClear();
		vi.useFakeTimers({ toFake: ["Date"] });
		setPreview("b1", '"1"', "data:image/png;base64,OLD");
		vi.setSystemTime(Date.now() + 60_000);
		vi.mocked(api.boardPreview).mockResolvedValue({
			etag: '"1"',
			data: { background: "plain", strokes: [] },
		});
		act(() => render(<BoardPreview boardId="b1" />, root));
		await flush();
		expect(img()?.src).toBe("data:image/png;base64,OLD");
		expect(renderPreview).not.toHaveBeenCalled();
	});

	test("a board checked a moment ago does not ask the server at all", () => {
		setPreview("b1", '"1"', "data:image/png;base64,OLD");
		act(() => render(<BoardPreview boardId="b1" />, root));
		expect(api.boardPreview).not.toHaveBeenCalled();
		expect(img()?.src).toBe("data:image/png;base64,OLD");
	});

	test("a board never seen is fetched and drawn", async () => {
		vi.mocked(api.boardPreview).mockResolvedValue({
			etag: '"9"',
			data: { background: "plain", strokes: [] },
		});
		act(() => render(<BoardPreview boardId="new" />, root));
		await flush();
		expect(img()?.src).toBe("data:image/png;base64,NEW");
	});

	test("a picture kept by the server is shown as it is, nothing is fetched or drawn (R-088)", async () => {
		const { renderPreview } = await import("./board/preview");
		vi.mocked(renderPreview).mockClear();
		vi.mocked(api.boardPreviewPicture).mockResolvedValue({
			etag: '"5"',
			url: "data:image/png;base64,SERVER",
		});
		act(() => render(<BoardPreview boardId="b7" />, root));
		await flush();
		expect(img()?.src).toBe("data:image/png;base64,SERVER");
		expect(api.boardPreview).not.toHaveBeenCalled();
		expect(renderPreview).not.toHaveBeenCalled();
	});

	test("without a stored picture the owner's tile draws it and leaves it with the server (R-088)", async () => {
		vi.mocked(api.boardPreview).mockResolvedValue({
			etag: '"9"',
			data: { background: "plain", strokes: [] },
		});
		act(() => render(<BoardPreview boardId="b8" mine />, root));
		await flush();
		expect(api.storePreviewPicture).toHaveBeenCalledWith(
			"b8",
			'"9"',
			"data:image/png;base64,NEW",
		);
	});

	test("somebody else's tile draws it but does not store it (R-088)", async () => {
		vi.mocked(api.boardPreview).mockResolvedValue({
			etag: '"9"',
			data: { background: "plain", strokes: [] },
		});
		act(() => render(<BoardPreview boardId="b9" />, root));
		await flush();
		expect(img()?.src).toBe("data:image/png;base64,NEW");
		expect(api.storePreviewPicture).not.toHaveBeenCalled();
	});
});
