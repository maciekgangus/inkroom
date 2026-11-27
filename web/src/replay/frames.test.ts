import { describe, expect, test } from "vitest";
import { frameCount, frameTimeMs, keyframeEvery } from "./frames";

describe("the frames of a rendered video (R-115)", () => {
	test("one frame every 1/fps of the recording, from time 0", () => {
		expect(frameTimeMs(0, 30)).toBe(0);
		expect(frameTimeMs(30, 30)).toBe(1000);
		expect(frameTimeMs(45, 30)).toBe(1500);
	});

	test("enough frames to cover the whole recording, never none", () => {
		expect(frameCount(1000, 30)).toBe(30);
		expect(frameCount(1001, 30)).toBe(31); // the last bit of a second still gets a frame
		expect(frameCount(0, 30)).toBe(1);
		expect(frameCount(3_600_000, 30)).toBe(108_000);
	});

	test("a keyframe every two seconds, so the video can be seeked", () => {
		expect(keyframeEvery(30)).toBe(60);
		expect(keyframeEvery(25)).toBe(50);
	});
});
