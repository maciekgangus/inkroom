import { describe, expect, test, vi } from "vitest";
import { FollowState, fitRect, followStep, stepView } from "./follow";

describe("fitRect", () => {
	test("shows the whole rectangle, centred, with a margin, whatever the window", () => {
		const rect = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
		const v = fitRect(rect, 500, 800);
		// The width limits: 500 px for 1000 units, less the margin.
		expect(v.scale).toBeLessThan(0.5);
		expect(v.scale).toBeGreaterThan(0.4);
		// The centre of the rectangle is the centre of the window.
		expect(v.x + 500 / 2 / v.scale).toBeCloseTo(500);
		expect(v.y + 800 / 2 / v.scale).toBeCloseTo(250);
		// All of it is inside the window.
		expect(v.x).toBeLessThan(0);
		expect(v.x + 500 / v.scale).toBeGreaterThan(1000);
	});

	test("the same window gives back (nearly) the same view", () => {
		const v = fitRect(
			{ minX: 100, minY: 50, maxX: 1380, maxY: 770 },
			1280,
			720,
		);
		expect(v.scale).toBeCloseTo(1 - 2 * 0.04, 1);
	});

	test("the scale stays within the zoom limits", () => {
		expect(
			fitRect({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 800, 600).scale,
		).toBe(5);
		expect(
			fitRect({ minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 }, 800, 600).scale,
		).toBe(0.1);
	});
});

describe("stepView", () => {
	const from = { x: 0, y: 0, scale: 1 };
	const to = { x: 400, y: 200, scale: 2 };

	test("moves towards the target without overshooting", () => {
		const v = stepView(from, to, 16);
		expect(v.x).toBeGreaterThan(0);
		expect(v.x).toBeLessThan(400);
		expect(v.scale).toBeGreaterThan(1);
		expect(v.scale).toBeLessThan(2);
	});

	test("a longer step gets closer", () => {
		expect(stepView(from, to, 200).x).toBeGreaterThan(stepView(from, to, 16).x);
	});

	test("lands on the target once it is close", () => {
		let v = from;
		for (let i = 0; i < 200; i++) v = stepView(v, to, 16);
		expect(v.x).toBeCloseTo(400, 1);
		expect(v.y).toBeCloseTo(200, 1);
		expect(v.scale).toBeCloseTo(2, 3);
		expect(stepView(v, to, 16)).toEqual(to);
	});
});

describe("FollowState", () => {
	const rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
	const make = () => {
		const io = {
			self: "me",
			follow: vi.fn(),
			sendView: vi.fn(),
			invite: vi.fn(),
			rect: () => rect,
		};
		return { io, st: new FollowState(io) };
	};

	test("pressing someone's chip follows them, pressing it again stops", () => {
		const { io, st } = make();
		st.toggle("tutor");
		expect(st.following).toBe("tutor");
		expect(io.follow).toHaveBeenLastCalledWith("tutor");
		st.toggle("tutor");
		expect(st.following).toBe("");
		expect(io.follow).toHaveBeenLastCalledWith("");
		expect(st.lost).toBe("");
	});

	test("following someone else switches over", () => {
		const { io, st } = make();
		st.toggle("a");
		st.toggle("b");
		expect(st.following).toBe("b");
		expect(io.follow).toHaveBeenLastCalledWith("b");
	});

	test("their view becomes our target, only the followed person's", () => {
		const { st } = make();
		st.toggle("tutor");
		st.onView("other", { minX: 1, minY: 1, maxX: 2, maxY: 2 });
		expect(st.target).toBeNull();
		st.onView("tutor", rect);
		expect(st.target).toEqual(rect);
	});

	test("our own movement stops following and offers the way back", () => {
		const { io, st } = make();
		st.toggle("tutor");
		st.onView("tutor", rect);
		st.userMoved();
		expect(st.following).toBe("");
		expect(st.target).toBeNull();
		expect(st.lost).toBe("tutor");
		expect(io.follow).toHaveBeenLastCalledWith("");
		st.userMoved(); // nothing more to stop
		expect(io.follow).toHaveBeenCalledTimes(2);
		st.back();
		expect(st.following).toBe("tutor");
		expect(st.lost).toBe("");
		expect(io.follow).toHaveBeenLastCalledWith("tutor");
	});

	test("moving while not following changes nothing", () => {
		const { io, st } = make();
		st.userMoved();
		expect(io.follow).not.toHaveBeenCalled();
		expect(st.lost).toBe("");
	});

	test("an invite shows a banner; joining follows, dismissing hides it", () => {
		const { st } = make();
		st.onInvite("tutor");
		expect(st.invite).toBe("tutor");
		st.join();
		expect(st.following).toBe("tutor");
		expect(st.invite).toBe("");
		st.onInvite("tutor"); // already following: no banner
		expect(st.invite).toBe("");
		st.toggle("tutor");
		st.onInvite("tutor");
		st.dismissInvite();
		expect(st.invite).toBe("");
	});

	test("a presenter sends the view only while someone follows, and at once when the first joins", () => {
		const { io, st } = make();
		st.viewChanged(rect);
		expect(io.sendView).not.toHaveBeenCalled();
		st.onFollowers(1);
		// even if it is the same view as before: the new follower has not seen it
		expect(io.sendView).toHaveBeenCalledWith(rect, true);
		st.viewChanged({ ...rect, minX: 5 });
		expect(io.sendView).toHaveBeenCalledTimes(2);
		st.onFollowers(0);
		st.viewChanged({ ...rect, minX: 9 });
		expect(io.sendView).toHaveBeenCalledTimes(2);
	});

	test("showing our view invites everyone", () => {
		const { io, st } = make();
		st.showMyView();
		expect(io.invite).toHaveBeenCalledOnce();
	});

	test("when the followed person leaves, following ends quietly", () => {
		const { io, st } = make();
		st.toggle("tutor");
		st.peersChanged([{ id: "me" }, { id: "x" }]);
		expect(st.following).toBe("");
		expect(st.lost).toBe("");
		expect(io.follow).toHaveBeenLastCalledWith("");
		st.onInvite("tutor");
		st.peersChanged([{ id: "me" }]); // the inviter is gone: the banner goes too
		expect(st.invite).toBe("");
	});

	describe("circles and chains", () => {
		const peers = (...p: [string, string?][]) =>
			p.map(([id, follows]) => (follows ? { id, follows } : { id }));

		test("a chain is fine: I follow b, who follows c", () => {
			const { st } = make();
			st.peersChanged(peers(["me"], ["b", "c"], ["c"]));
			st.toggle("b");
			expect(st.following).toBe("b");
			expect(st.notice).toBe("");
		});

		test("following someone who follows me is refused, with a word", () => {
			const { io, st } = make();
			st.peersChanged(peers(["me"], ["b", "me"]));
			st.toggle("b");
			expect(st.following).toBe("");
			expect(st.notice).toBe("Ta osoba właśnie śledzi Ciebie");
			expect(io.follow).not.toHaveBeenCalled();
		});

		test("so is following someone who follows me through others", () => {
			const { io, st } = make();
			st.peersChanged(peers(["me"], ["a", "b"], ["b", "c"], ["c", "me"]));
			st.toggle("a");
			expect(st.following).toBe("");
			expect(st.notice).not.toBe("");
			expect(io.follow).not.toHaveBeenCalled();
		});

		test("a circle among others that does not include me does not hang it", () => {
			const { st } = make();
			st.peersChanged(peers(["me"], ["a", "b"], ["b", "a"]));
			st.toggle("a"); // cannot happen on the server; must not loop forever here
			expect(st.following).toBe("");
		});

		test("the server's refusal ends what we asked for and says why", () => {
			const { st } = make();
			st.toggle("b");
			st.refused("b");
			expect(st.following).toBe("");
			expect(st.notice).toBe("Ta osoba właśnie śledzi Ciebie");
			st.clearNotice();
			expect(st.notice).toBe("");
		});

		test("the end sent by the server leaves no way back", () => {
			const { st } = make();
			st.toggle("b");
			st.ended("b");
			expect(st.following).toBe("");
			expect(st.lost).toBe("");
		});

		test("the follows of the people are kept up to date", () => {
			const { st } = make();
			st.peersChanged(peers(["me"], ["b", "me"]));
			st.peersChanged(peers(["me"], ["b"])); // b stopped
			st.toggle("b");
			expect(st.following).toBe("b");
		});
	});
});

describe("followStep", () => {
	const rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
	const make = () => {
		const st = new FollowState({
			self: "me",
			follow: () => {},
			sendView: () => {},
			invite: () => {},
			rect: () => rect,
		});
		st.toggle("tutor");
		st.onView("tutor", rect);
		return st;
	};
	const cur = { x: 5000, y: 5000, scale: 1 };

	test("moves towards the followed view", () => {
		const v = followStep(make(), cur, 1000, 700, 16, false);
		expect(v).not.toBeNull();
		expect(v?.x).toBeLessThan(5000);
	});

	test("stands still while the pen is down or a text is edited, then catches up", () => {
		const st = make();
		expect(followStep(st, cur, 1000, 700, 16, true)).toBeNull();
		expect(followStep(st, cur, 1000, 700, 16, false)).not.toBeNull();
	});

	test("does nothing when not following or without a view yet", () => {
		const st = new FollowState({
			self: "me",
			follow: () => {},
			sendView: () => {},
			invite: () => {},
			rect: () => rect,
		});
		expect(followStep(st, cur, 1000, 700, 16, false)).toBeNull();
		st.toggle("tutor");
		expect(followStep(st, cur, 1000, 700, 16, false)).toBeNull();
	});

	test("is done once the view has arrived", () => {
		const st = make();
		const arrived = fitRect(rect, 1000, 700);
		expect(followStep(st, arrived, 1000, 700, 16, false)).toBeNull();
	});
});
