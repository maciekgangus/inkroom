import { useState } from "preact/hooks";
import {
	COEF_LIMIT,
	FN_KINDS,
	FN_PRESETS,
	fnFormula,
	MAX_FNS,
	newFn,
	type PlaneFn,
} from "./board/functions";
import type { StylePatch } from "./board/style";
import { Icon } from "./icon";
import { Slider } from "./slider";

/** The colours a new function takes in turn, none of them the black of the axes. */
export const FN_COLORS = [
	"#d32f2f",
	"#1976d2",
	"#388e3c",
	"#f57c00",
	"#7b1fa2",
	"#00838f",
	"#c2185b",
	"#5d4037",
];

const makeId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Rounds away float noise; the `+ 0` turns a negative zero into 0. */
const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const clampCoef = (n: number) => Math.max(-COEF_LIMIT, Math.min(COEF_LIMIT, n));

/** The coefficients of a quadratic written the other way (vertex form ⇄ ax² + bx + c), same curve. */
function convertQuad(f: PlaneFn, canon: boolean): PlaneFn {
	const [a, u, v] = f.c;
	let c: number[];
	if (canon)
		c =
			a === 0
				? [a, 0, v]
				: [a, round(-u / (2 * a)), round(v - (u * u) / (4 * a))];
	else c = [a, round(-2 * a * u), round(a * u * u + v)];
	const out: PlaneFn = { ...f, c: c.map(clampCoef) };
	if (canon) out.canon = true;
	else delete out.canon;
	return out;
}

/** The names of a function's coefficients as the fields show them. */
const namesOf = (f: PlaneFn): string[] =>
	f.k === "quad" && f.canon ? ["a", "p", "q"] : FN_PRESETS[f.k].names;

/**
 * The function graphs of the selected coordinate plane (R-092): a list of the curves with their
 * coefficients as fields and sliders, a colour and a width each, and a button that adds one from
 * the ready formulas. A change is the whole new list, so it goes to the others like any property.
 */
export function FunctionEditor({
	fns,
	display = (c) => c,
	onPreview,
	onChange,
}: {
	fns: PlaneFn[];
	/** How a stored colour is shown (dark mode swaps black and white). */
	display?: (color: string) => string;
	onPreview: (patch: StylePatch) => void;
	onChange: (patch: StylePatch) => void;
}) {
	const [picking, setPicking] = useState(false);
	/** The curve whose colours are open: they are behind its dot, one tap away. */
	const [colorsOf, setColorsOf] = useState<string | null>(null);
	const replace = (id: string, next: PlaneFn) =>
		fns.map((f) => (f.id === id ? next : f));
	const full = fns.length >= MAX_FNS;
	return (
		<div class="prop-group fns">
			<div class="fns-head">
				<span class="fns-label">Funkcje</span>
				<button
					type="button"
					class={`fn-add${picking ? " active" : ""}`}
					aria-label="fn add"
					aria-expanded={picking}
					title={full ? `Najwyżej ${MAX_FNS} funkcji` : "Dodaj funkcję"}
					disabled={full}
					onClick={() => setPicking(!picking)}
				>
					<Icon name="plus" />
					Dodaj
				</button>
			</div>
			{picking && !full && (
				<div class="fn-presets">
					{FN_KINDS.map((k) => (
						<button
							type="button"
							key={k}
							aria-label={`fn add ${k}`}
							onClick={() => {
								const free =
									FN_COLORS.find((c) => !fns.some((f) => f.color === c)) ??
									FN_COLORS[fns.length % FN_COLORS.length];
								onChange({ fns: [...fns, newFn(k, makeId(), free)] });
								setPicking(false);
							}}
						>
							<span>{FN_PRESETS[k].label}</span>
							<small>{FN_PRESETS[k].formula}</small>
						</button>
					))}
				</div>
			)}
			{fns.map((f) => (
				<div class="fn" key={f.id} data-fn={f.id}>
					<div class="fn-title">
						<span class="fn-formula">{fnFormula(f)}</span>
						<button
							type="button"
							class="icon fn-remove"
							aria-label={`fn remove ${f.id}`}
							title="Usuń funkcję"
							onClick={() =>
								onChange({ fns: fns.filter((x) => x.id !== f.id) })
							}
						>
							<Icon name="trash" />
						</button>
					</div>
					<div class="fn-row fn-color-row">
						<button
							type="button"
							class="swatch"
							style={{ "--swatch": display(f.color) }}
							aria-label={`fn ${f.id} colors`}
							aria-expanded={colorsOf === f.id}
							title="Kolor wykresu"
							onClick={() => setColorsOf(colorsOf === f.id ? null : f.id)}
						/>
						<span class="fn-row-label">Kolor wykresu</span>
					</div>
					<div class={`fn-colors-wrap${colorsOf === f.id ? " open" : ""}`}>
						<div class="palette-grid fn-colors">
							{FN_COLORS.map((c) => (
								<button
									type="button"
									key={c}
									tabIndex={colorsOf === f.id ? 0 : -1}
									class={`swatch${f.color === c ? " active" : ""}`}
									style={{ "--swatch": display(c) }}
									aria-label={`fn ${f.id} color ${c}`}
									aria-pressed={f.color === c}
									onClick={() => {
										onChange({ fns: replace(f.id, { ...f, color: c }) });
										setColorsOf(null);
									}}
								/>
							))}
						</div>
					</div>
					{f.k === "quad" && (
						<button
							type="button"
							class={`fn-canon${f.canon ? " active" : ""}`}
							aria-label={`fn canon ${f.id}`}
							aria-pressed={f.canon === true}
							onClick={() =>
								onChange({ fns: replace(f.id, convertQuad(f, !f.canon)) })
							}
						>
							Postać kanoniczna
						</button>
					)}
					{namesOf(f).map((name, i) => {
						const v = f.c[i];
						const lim = Math.min(
							COEF_LIMIT,
							Math.max(10, Math.ceil(Math.abs(v))),
						);
						const set = (n: number) => {
							const c = [...f.c];
							c[i] = clampCoef(round(n));
							return { ...f, c };
						};
						return (
							<div class="fn-coef" key={name}>
								<span class="fn-name">{name}</span>
								<input
									type="number"
									step="any"
									aria-label={`fn ${f.id} coef ${i}`}
									value={v}
									onChange={(e) => {
										const n = Number(e.currentTarget.value);
										if (Number.isFinite(n))
											onChange({ fns: replace(f.id, set(n)) });
									}}
								/>
								<Slider
									label={`fn ${f.id} slider ${i}`}
									min={-lim}
									max={lim}
									step={0.1}
									value={v}
									unit=""
									onInput={(n) => onPreview({ fns: replace(f.id, set(n)) })}
									onChange={(n) => onChange({ fns: replace(f.id, set(n)) })}
								/>
							</div>
						);
					})}
					<Slider
						icon="width"
						label={`fn ${f.id} width`}
						min={0.5}
						max={10}
						step={0.5}
						value={f.w}
						unit=" px"
						onInput={(w) => onPreview({ fns: replace(f.id, { ...f, w }) })}
						onChange={(w) => onChange({ fns: replace(f.id, { ...f, w }) })}
					/>
				</div>
			))}
		</div>
	);
}
