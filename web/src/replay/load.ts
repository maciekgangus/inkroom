import type { LogEvent } from "../recording-log";
import { ReplayEngine, type Snapshot } from "./engine";

/** What `GET .../play` answers: where the sound and the event log are (R-114). */
export interface PlayIndex {
	v: number;
	name: string;
	durationMs: number;
	mime: string;
	audio: string;
	snapshot: string;
	segments: string[];
}

export async function getJSON<T>(url: string): Promise<T> {
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) {
		let message = `Błąd ${res.status}`;
		try {
			message = ((await res.json()) as { error?: string }).error ?? message;
		} catch {
			// not JSON: the status will do
		}
		throw new Error(message);
	}
	return (await res.json()) as T;
}

/** Reads the index, the starting state and every segment of the log (a missing segment is empty). */
export async function load(boardId: string, recId: string) {
	const index = await getJSON<PlayIndex>(
		`/api/boards/${boardId}/recordings/${recId}/play`,
	);
	const [snapshot, segments] = await Promise.all([
		getJSON<Snapshot>(index.snapshot),
		Promise.all(
			index.segments.map((u) => getJSON<LogEvent[]>(u).catch(() => [])),
		),
	]);
	return { index, engine: new ReplayEngine(snapshot, segments.flat()) };
}
