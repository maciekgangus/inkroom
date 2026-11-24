import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { FONT_FAMILIES, FONT_KEYS, type FontKey } from "./board/text-wrap";
import { ColorRow } from "./color-row";
import { activeFormats, type LineStyle, lineStyleOf } from "./md-edit";

/** The sizes of the list, as in a word processor (px at 100% zoom). */
export const SIZES = [
	8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96,
];

/** The next size up (dir 1) or down (dir -1) in the list; a size off the list goes to its neighbour. */
export function stepSize(current: number, dir: 1 | -1): number {
	const now = Math.round(current);
	if (dir === 1) return SIZES.find((s) => s > now) ?? SIZES[SIZES.length - 1];
	return [...SIZES].reverse().find((s) => s < now) ?? SIZES[0];
}

const STYLES: { key: LineStyle; label: string }[] = [
	{ key: "p", label: "Tekst" },
	{ key: "h1", label: "Nagłówek 1" },
	{ key: "h2", label: "Nagłówek 2" },
	{ key: "h3", label: "Nagłówek 3" },
];

/** What the toolbar changes about the whole text; the formatting inside it is Markdown. */
export interface TextFormat {
	font: FontKey;
	/** Font size in board units (px at 100% zoom). */
	size: number;
	/** The colour as stored; `display` turns it into what the theme shows. */
	color: string;
	colors: string[];
	display: (color: string) => string;
	onFont: (font: FontKey) => void;
	onSize: (size: number) => void;
	onColor: (color: string) => void;
}

interface Props {
	field: { current: HTMLTextAreaElement | null };
	/** Screen position of the field's top-left corner, and its bottom edge. */
	x: number;
	y: number;
	bottom: number;
	format?: TextFormat;
	onWrap: (marker: string) => void;
	onLine: (style: LineStyle) => void;
}

type MenuName = "font" | "size" | "style" | "color" | "help";

function Btn({
	label,
	pressed,
	onClick,
	children,
	wide,
	menu,
}: {
	label: string;
	pressed?: boolean;
	onClick: () => void;
	children: ComponentChildren;
	wide?: boolean;
	menu?: boolean;
}) {
	return (
		<button
			type="button"
			class={`tb-btn${wide ? " wide" : ""}${pressed ? " on" : ""}`}
			aria-label={label}
			title={label}
			aria-pressed={pressed === undefined ? undefined : pressed}
			aria-haspopup={menu ? "true" : undefined}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

const Caret = () => (
	<svg class="tb-caret" viewBox="0 0 10 6" aria-hidden="true">
		<path d="M1 1l4 4 4-4" />
	</svg>
);

function Glyph({ d }: { d: string }) {
	return (
		<svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d={d} />
		</svg>
	);
}

const LIST_ICON = "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01";
const NUM_ICON =
	"M10 6h10M10 12h10M10 18h10M4 4.5l1.5-.8V9M4 14.5c.4-.8 2.3-.9 2.3.4 0 .8-1 1.2-2.3 2.6h2.4";
const QUOTE_ICON =
	"M5 7h5v5c0 2.5-1 3.7-3.5 4.500M14 7h5v5c0 2.5-1 3.7-3.5 4.500";

/**
 * The bar over a text being typed (R-101), laid out like a word processor's: font, size, then
 * bold, italic, strike and code, the style of the line (heading), lists and quote, the colour,
 * and a cheat sheet of the syntax. The field keeps its focus and selection all the time.
 */
export function TextToolbar({
	field,
	x,
	y,
	bottom,
	format,
	onWrap,
	onLine,
}: Props) {
	const [open, setOpen] = useState<MenuName | null>(null);
	const [, setRev] = useState(0);
	const bar = useRef<HTMLDivElement>(null);

	// The pressed buttons follow the cursor.
	useEffect(() => {
		const onSelect = () => {
			if (document.activeElement === field.current) setRev((r) => r + 1);
		};
		document.addEventListener("selectionchange", onSelect);
		return () => document.removeEventListener("selectionchange", onSelect);
	}, [field]);

	// A press outside the bar closes its menu.
	useEffect(() => {
		if (!open) return;
		const away = (e: Event) => {
			if (!bar.current?.contains(e.target as Node)) setOpen(null);
		};
		document.addEventListener("pointerdown", away);
		return () => document.removeEventListener("pointerdown", away);
	}, [open]);

	const el = field.current;
	const value = el?.value ?? "";
	const s = el?.selectionStart ?? 0;
	const e = el?.selectionEnd ?? 0;
	const fmt = activeFormats(value, s, e);
	const line = lineStyleOf(value, s, e);
	const toggle = (m: MenuName) => setOpen(open === m ? null : m);
	const pick = (fn: () => void) => () => {
		fn();
		setOpen(null);
	};

	// Over the field when there is room, under it when not; menus open away from the field.
	const above = y > 72;
	const room = above ? y - 76 : window.innerHeight - bottom - 76;
	const left = Math.max(8, Math.min(x, window.innerWidth - 600));
	const style = {
		left: `${left}px`,
		maxWidth: `${window.innerWidth - left - 8}px`,
		top: `${above ? y - 8 : bottom + 8}px`,
		"--room": `${Math.max(140, room)}px`,
	};

	return (
		<div
			ref={bar}
			class={`text-toolbar ${above ? "above" : "below"}`}
			role="toolbar"
			aria-label="Formatowanie tekstu"
			style={style}
			onMouseDown={(ev) => {
				if ((ev.target as HTMLElement).tagName !== "INPUT") ev.preventDefault();
			}}
		>
			{format && (
				<>
					<div class="tb-group">
						<div class="tb-wrap">
							<button
								type="button"
								class="tb-btn tb-select font"
								aria-label="Czcionka"
								title="Czcionka"
								aria-haspopup="listbox"
								aria-expanded={open === "font"}
								onClick={() => toggle("font")}
							>
								<span style={{ fontFamily: FONT_FAMILIES[format.font].css }}>
									{FONT_FAMILIES[format.font].label}
								</span>
								<Caret />
							</button>
							{open === "font" && (
								<div class="tb-menu" role="listbox" aria-label="Czcionki">
									{FONT_KEYS.map((k) => (
										<button
											type="button"
											key={k}
											role="option"
											aria-selected={k === format.font}
											class={`tb-item${k === format.font ? " on" : ""}`}
											style={{ fontFamily: FONT_FAMILIES[k].css }}
											onClick={pick(() => format.onFont(k))}
										>
											{FONT_FAMILIES[k].label}
										</button>
									))}
								</div>
							)}
						</div>
						<Btn
							label="Zmniejsz rozmiar"
							onClick={() => format.onSize(stepSize(format.size, -1))}
						>
							<span class="tb-glyph">−</span>
						</Btn>
						<div class="tb-wrap">
							<button
								type="button"
								class="tb-btn tb-select size"
								aria-label="Rozmiar czcionki"
								title="Rozmiar czcionki"
								aria-haspopup="listbox"
								aria-expanded={open === "size"}
								onClick={() => toggle("size")}
							>
								<span>{Math.round(format.size)}</span>
								<Caret />
							</button>
							{open === "size" && (
								<div class="tb-menu sizes" role="listbox" aria-label="Rozmiary">
									{SIZES.map((n) => (
										<button
											type="button"
											key={n}
											role="option"
											aria-selected={n === Math.round(format.size)}
											class={`tb-item${n === Math.round(format.size) ? " on" : ""}`}
											onClick={pick(() => format.onSize(n))}
										>
											{n}
										</button>
									))}
								</div>
							)}
						</div>
						<Btn
							label="Zwiększ rozmiar"
							onClick={() => format.onSize(stepSize(format.size, 1))}
						>
							<span class="tb-glyph">+</span>
						</Btn>
					</div>
					<span class="tb-sep" />
				</>
			)}
			<div class="tb-group">
				<Btn
					label="Pogrubienie (Ctrl+B)"
					pressed={fmt.bold}
					onClick={() => onWrap("**")}
				>
					<b>B</b>
				</Btn>
				<Btn
					label="Kursywa (Ctrl+I)"
					pressed={fmt.italic}
					onClick={() => onWrap("*")}
				>
					<i class="tb-serif">I</i>
				</Btn>
				<Btn
					label="Przekreślenie (Ctrl+D)"
					pressed={fmt.strike}
					onClick={() => onWrap("~~")}
				>
					<s>S</s>
				</Btn>
				<Btn
					label="Kod (Ctrl+E)"
					pressed={fmt.code}
					onClick={() => onWrap("`")}
				>
					<span class="tb-code">&lt;/&gt;</span>
				</Btn>
			</div>
			<span class="tb-sep" />
			<div class="tb-group">
				<div class="tb-wrap">
					<button
						type="button"
						class="tb-btn tb-select style"
						aria-label="Styl wiersza"
						title="Styl wiersza"
						aria-haspopup="listbox"
						aria-expanded={open === "style"}
						onClick={() => toggle("style")}
					>
						<span>{STYLES.find((t) => t.key === line)?.label ?? "Tekst"}</span>
						<Caret />
					</button>
					{open === "style" && (
						<div class="tb-menu" role="listbox" aria-label="Style">
							{STYLES.map((t) => (
								<button
									type="button"
									key={t.key}
									role="option"
									aria-selected={t.key === line}
									class={`tb-item style-${t.key}${t.key === line ? " on" : ""}`}
									onClick={pick(() => onLine(t.key))}
								>
									{t.label}
								</button>
							))}
						</div>
					)}
				</div>
				<Btn
					label="Lista punktowana"
					pressed={line === "ul"}
					onClick={() => onLine("ul")}
				>
					<Glyph d={LIST_ICON} />
				</Btn>
				<Btn
					label="Lista numerowana"
					pressed={line === "ol"}
					onClick={() => onLine("ol")}
				>
					<Glyph d={NUM_ICON} />
				</Btn>
				<Btn
					label="Cytat"
					pressed={line === "quote"}
					onClick={() => onLine("quote")}
				>
					<Glyph d={QUOTE_ICON} />
				</Btn>
			</div>
			{format && (
				<>
					<span class="tb-sep" />
					<div class="tb-group">
						<div class="tb-wrap">
							<button
								type="button"
								class="tb-btn tb-select color"
								aria-label="Kolor tekstu"
								title="Kolor tekstu"
								aria-haspopup="true"
								aria-expanded={open === "color"}
								onClick={() => toggle("color")}
							>
								<span class="tb-a">
									A
									<span
										class="tb-bar"
										style={{ background: format.display(format.color) }}
									/>
								</span>
								<Caret />
							</button>
							{open === "color" && (
								<div class="tb-menu color-menu">
									<ColorRow
										prefix="text color"
										current={format.color}
										colors={format.colors}
										display={format.display}
										onPreview={format.onColor}
										onPick={(c) => c && format.onColor(c)}
										onChosen={() => setOpen(null)}
									/>
								</div>
							)}
						</div>
					</div>
				</>
			)}
			<span class="tb-sep" />
			<div class="tb-wrap">
				<Btn
					label="Ściąga Markdown"
					pressed={open === "help"}
					menu
					onClick={() => toggle("help")}
				>
					<span class="tb-glyph">?</span>
				</Btn>
				{open === "help" && (
					<div class="tb-menu help" role="dialog" aria-label="Ściąga Markdown">
						<table>
							<tbody>
								<tr>
									<td>
										<code>**tekst**</code>
									</td>
									<td>
										<b>pogrubienie</b>
									</td>
								</tr>
								<tr>
									<td>
										<code>*tekst*</code>
									</td>
									<td>
										<i>kursywa</i>
									</td>
								</tr>
								<tr>
									<td>
										<code>~~tekst~~</code>
									</td>
									<td>
										<s>przekreślenie</s>
									</td>
								</tr>
								<tr>
									<td>
										<code>`kod`</code>
									</td>
									<td>
										<code>kod</code>
									</td>
								</tr>
								<tr>
									<td>
										<code># Nagłówek</code>
									</td>
									<td>
										<code>##</code>, <code>###</code> mniejsze
									</td>
								</tr>
								<tr>
									<td>
										<code>- punkt</code>
									</td>
									<td>
										lista, <code>1. punkt</code> numerowana
									</td>
								</tr>
								<tr>
									<td>
										<code>&gt; cytat</code>
									</td>
									<td>cytat</td>
								</tr>
								<tr>
									<td>
										<code>\*</code>
									</td>
									<td>znak bez formatowania</td>
								</tr>
							</tbody>
						</table>
						<p>
							Skróty: <kbd>Ctrl+B</kbd> <kbd>Ctrl+I</kbd> <kbd>Ctrl+D</kbd>{" "}
							<kbd>Ctrl+E</kbd>. <kbd>Ctrl+Enter</kbd> zatwierdza tekst.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
