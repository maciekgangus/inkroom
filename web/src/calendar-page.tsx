import { useCallback, useEffect, useState } from "preact/hooks";
import type { Lesson } from "./api";
import * as api from "./api";

// The calendar page (R-104 to R-108). A plain first version: the design comes later.

const DAY = 24 * 3600 * 1000;
const STATUS = { scheduled: "", done: "odbyte", cancelled: "odwołane" };

const fmt = (iso: string) =>
	new Date(iso).toLocaleString("pl-PL", {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

/** The value of a datetime-local input as an ISO time (the input is in the local zone). */
const toIso = (local: string) => new Date(local).toISOString();

export function CalendarPage({ navigate }: { navigate: (to: string) => void }) {
	const [data, setData] = useState<api.CalendarData | null>(null);
	const [error, setError] = useState("");
	const reload = useCallback(
		() =>
			api
				.getCalendar(
					new Date(Date.now() - 7 * DAY),
					new Date(Date.now() + 90 * DAY),
				)
				.then(setData)
				.catch((e) => {
					if (e instanceof Error && /zalogowany/i.test(e.message))
						navigate("/");
					else setError(api.errorMessage(e));
				}),
		[navigate],
	);
	useEffect(() => {
		reload();
	}, [reload]);
	/** Runs a change, then shows the calendar as the server has it (or the error). */
	const act = async (f: () => Promise<unknown>) => {
		setError("");
		try {
			await f();
			await reload();
		} catch (e) {
			setError(api.errorMessage(e));
		}
	};

	if (!data) return error ? <p class="error">{error}</p> : null;
	return (
		<main class="panel calendar">
			<header class="row between">
				<h1>Kalendarz</h1>
				<a href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
					Tablice
				</a>
			</header>
			{error && (
				<p class="error" role="alert">
					{error}
				</p>
			)}
			{data.requests.length > 0 && (
				<section>
					<h2>Prośby o zmianę terminu</h2>
					<ul>
						{data.requests.map((r) => (
							<li key={r.id}>
								{r.mine ? "Twoja prośba" : `Prośba od ${r.from}`}: „
								{r.lessonTitle}” na {fmt(r.start)}
								{r.note && ` (${r.note})`}{" "}
								{r.mine ? (
									<button
										type="button"
										onClick={() => act(() => api.answerRequest(r.id, "cancel"))}
									>
										Wycofaj
									</button>
								) : (
									<>
										<button
											type="button"
											class="primary"
											onClick={() =>
												act(() => api.answerRequest(r.id, "accept"))
											}
										>
											Zgódź się
										</button>{" "}
										<button
											type="button"
											onClick={() =>
												act(() => api.answerRequest(r.id, "reject"))
											}
										>
											Odrzuć
										</button>
									</>
								)}
							</li>
						))}
					</ul>
				</section>
			)}
			<section>
				<h2>Zajęcia</h2>
				{data.lessons.length === 0 && <p class="muted">Brak zajęć.</p>}
				<ul>
					{data.lessons.map((l) => (
						<LessonRow key={l.id} lesson={l} act={act} />
					))}
				</ul>
			</section>
			<NewLesson act={act} />
			<Unavailability data={data} act={act} />
		</main>
	);
}

type Act = (f: () => Promise<unknown>) => Promise<void>;

function LessonRow({ lesson: l, act }: { lesson: Lesson; act: Act }) {
	const teacher = l.role === "teacher";
	const [note, setNote] = useState(l.note);
	const [homework, setHomework] = useState(l.homework);
	const [move, setMove] = useState("");
	const minutes =
		(new Date(l.end).getTime() - new Date(l.start).getTime()) / 60000;
	return (
		<li class={l.status === "cancelled" ? "muted" : ""}>
			<strong>{fmt(l.start)}</strong> {l.title} (
			{teacher ? `uczeń: ${l.student}` : `prowadzi: ${l.teacher}`})
			{l.status !== "scheduled" && ` [${STATUS[l.status]}]`}{" "}
			{l.boardId ? (
				<a href={`/b/${l.boardId}`}>Tablica</a>
			) : (
				teacher && (
					<button
						type="button"
						onClick={() => act(() => api.linkLessonBoard(l.id))}
					>
						Utwórz tablicę
					</button>
				)
			)}
			<details>
				<summary>Szczegóły</summary>
				<label>
					Notatka z lekcji
					<textarea
						value={note}
						disabled={!teacher}
						onInput={(e) => setNote(e.currentTarget.value)}
					/>
				</label>
				<label>
					Praca domowa
					<textarea
						value={homework}
						disabled={!teacher}
						onInput={(e) => setHomework(e.currentTarget.value)}
					/>
				</label>
				{teacher && (
					<p class="row">
						<button
							type="button"
							onClick={() =>
								act(() => api.updateLesson(l.id, { note, homework }))
							}
						>
							Zapisz
						</button>
						<button
							type="button"
							onClick={() =>
								act(() => api.updateLesson(l.id, { status: "done" }))
							}
						>
							Odbyte
						</button>
						<button
							type="button"
							onClick={() =>
								act(() => api.updateLesson(l.id, { status: "cancelled" }))
							}
						>
							Odwołaj
						</button>
						<button
							type="button"
							class="danger"
							onClick={() =>
								confirm("Usunąć zajęcia?") && act(() => api.deleteLesson(l.id))
							}
						>
							Usuń
						</button>
					</p>
				)}
				{l.status === "scheduled" && (
					<p class="row">
						<input
							type="datetime-local"
							value={move}
							aria-label="Nowy termin"
							onInput={(e) => setMove(e.currentTarget.value)}
						/>
						<button
							type="button"
							disabled={!move}
							onClick={() =>
								act(() => {
									const start = new Date(move);
									return api.requestMove(l.id, {
										start: start.toISOString(),
										end: new Date(
											start.getTime() + minutes * 60000,
										).toISOString(),
										note: "",
									});
								})
							}
						>
							Poproś o zmianę terminu
						</button>
					</p>
				)}
			</details>
		</li>
	);
}

function NewLesson({ act }: { act: Act }) {
	const [student, setStudent] = useState("");
	const [title, setTitle] = useState("");
	const [start, setStart] = useState("");
	const [minutes, setMinutes] = useState(60);
	const [weekly, setWeekly] = useState(false);
	const [count, setCount] = useState(10);
	const submit = (e: Event) => {
		e.preventDefault();
		act(async () => {
			const from = new Date(start);
			if (weekly) {
				await api.createSeries({
					title,
					student,
					start: start.slice(0, 10),
					intervalWeeks: 1,
					slots: [
						{
							day: (from.getDay() + 6) % 7,
							time: start.slice(11, 16),
							minutes,
						},
					],
					count,
					zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				});
			} else {
				await api.createLesson({
					title,
					student,
					start: toIso(start),
					end: new Date(from.getTime() + minutes * 60000).toISOString(),
				});
			}
			setStart("");
		});
	};
	return (
		<section>
			<h2>Nowe zajęcia</h2>
			<form class="row" onSubmit={submit}>
				<input
					placeholder="Uczeń (nazwa lub e-mail)"
					value={student}
					required
					onInput={(e) => setStudent(e.currentTarget.value)}
				/>
				<input
					placeholder="Tytuł"
					value={title}
					onInput={(e) => setTitle(e.currentTarget.value)}
				/>
				<input
					type="datetime-local"
					value={start}
					required
					onInput={(e) => setStart(e.currentTarget.value)}
				/>
				<input
					type="number"
					min={15}
					max={720}
					step={15}
					value={minutes}
					aria-label="Minuty"
					onInput={(e) => setMinutes(Number(e.currentTarget.value))}
				/>
				<label>
					<input
						type="checkbox"
						checked={weekly}
						onChange={(e) => setWeekly(e.currentTarget.checked)}
					/>{" "}
					co tydzień
				</label>
				{weekly && (
					<input
						type="number"
						min={1}
						max={200}
						value={count}
						aria-label="Ile zajęć"
						onInput={(e) => setCount(Number(e.currentTarget.value))}
					/>
				)}
				<button type="submit" class="primary">
					Dodaj
				</button>
			</form>
		</section>
	);
}

function Unavailability({ data, act }: { data: api.CalendarData; act: Act }) {
	const [start, setStart] = useState("");
	const [end, setEnd] = useState("");
	const [note, setNote] = useState("");
	return (
		<section>
			<h2>Niedostępność</h2>
			<ul>
				{data.unavailable.map((u) => (
					<li key={u.id}>
						{fmt(u.start)} – {fmt(u.end)} {u.note}{" "}
						<button
							type="button"
							onClick={() => act(() => api.deleteUnavailable(u.id))}
						>
							Usuń
						</button>
					</li>
				))}
			</ul>
			<form
				class="row"
				onSubmit={(e) => {
					e.preventDefault();
					act(async () => {
						await api.addUnavailable({
							start: toIso(start),
							end: toIso(end),
							note,
						});
						setStart("");
						setEnd("");
						setNote("");
					});
				}}
			>
				<input
					type="datetime-local"
					value={start}
					required
					aria-label="Od"
					onInput={(e) => setStart(e.currentTarget.value)}
				/>
				<input
					type="datetime-local"
					value={end}
					required
					aria-label="Do"
					onInput={(e) => setEnd(e.currentTarget.value)}
				/>
				<input
					placeholder="Notatka"
					value={note}
					onInput={(e) => setNote(e.currentTarget.value)}
				/>
				<button type="submit">Dodaj</button>
			</form>
		</section>
	);
}
