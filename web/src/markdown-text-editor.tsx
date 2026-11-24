import { useEffect, useRef, useState } from "preact/hooks";
import type { FontKey } from "./board/text-wrap";
import { continueList, type Edit, setLineStyle, toggleWrap } from "./md-edit";
import { TextEditor } from "./text-editor";
import { type TextFormat, TextToolbar } from "./text-toolbar";

/**
 * Applies an edit of the Markdown source to the field as typing, so Ctrl+Z undoes it; where the
 * browser has no typed-edit command the text is replaced directly and the field told.
 */
export function applyEdit(el: HTMLTextAreaElement, e: Edit): void {
	el.focus();
	el.setSelectionRange(e.from, e.to);
	let done = false;
	try {
		if (typeof document.execCommand === "function") {
			done = e.insert
				? document.execCommand("insertText", false, e.insert)
				: document.execCommand("delete");
		}
	} catch {
		done = false;
	}
	if (!done) {
		el.setRangeText(e.insert, e.from, e.to, "end");
		el.dispatchEvent(new Event("input", { bubbles: true }));
	}
	el.setSelectionRange(e.selStart, e.selEnd);
}

interface Props {
	/** Screen position of the text's top-left corner. */
	x: number;
	y: number;
	/** Font size in screen pixels (already multiplied by the zoom). */
	fontSize: number;
	color: string;
	font?: FontKey;
	/**
	 * Set for a text area (R-044): the field is that wide (screen px), at least `minHeight` tall,
	 * wraps its text and grows with it; see TextEditor.
	 */
	width?: number;
	minHeight?: number;
	onResize?: () => void;
	initialText?: string;
	onCommit: (text: string) => void;
	onCancel: () => void;
	/** What the toolbar changes about the whole text: font, size, colour (R-101). */
	format?: TextFormat;
	/**
	 * The width of the field is dragged by the grip on its right edge (screen px; `final` when
	 * let go). Only the width changes, never the size of the text.
	 */
	onWidth?: (px: number, final: boolean) => void;
}

const MIN_FIELD = 60;

/**
 * The text field with the Word-like toolbar over it (R-101) and a grip on its right edge that
 * widens it without scaling the text. Formatting is Markdown in the text (R-102): the buttons
 * and Ctrl+B, I, D, E wrap the selection in markers, Enter in a list goes on with the list.
 */
export function MarkdownTextEditor({
	x,
	y,
	fontSize,
	color,
	font,
	width,
	minHeight,
	onResize,
	initialText,
	onCommit,
	onCancel,
	format,
	onWidth,
}: Props) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [, setTick] = useState(0);
	const area = width !== undefined;

	const wrap = (marker: string) => {
		const el = ref.current;
		if (el)
			applyEdit(
				el,
				toggleWrap(el.value, el.selectionStart, el.selectionEnd, marker),
			);
		setTick((t) => t + 1);
	};
	const line = (style: Parameters<typeof setLineStyle>[3]) => {
		const el = ref.current;
		if (el)
			applyEdit(
				el,
				setLineStyle(el.value, el.selectionStart, el.selectionEnd, style),
			);
		setTick((t) => t + 1);
	};

	// Ctrl or Cmd with B, I, D, E format the selection; Enter in a list goes on with the list.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const marks: Record<string, string> = { b: "**", i: "*", d: "~~", e: "`" };
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
				const mark = marks[e.key.toLowerCase()];
				if (mark) {
					e.preventDefault();
					applyEdit(
						el,
						toggleWrap(el.value, el.selectionStart, el.selectionEnd, mark),
					);
					return;
				}
			}
			if (
				area &&
				e.key === "Enter" &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.isComposing
			) {
				const edit = continueList(el.value, el.selectionStart, el.selectionEnd);
				if (edit) {
					e.preventDefault();
					applyEdit(el, edit);
				}
			}
		};
		el.addEventListener("keydown", onKey);
		return () => el.removeEventListener("keydown", onKey);
	}, [area]);

	const rect = ref.current?.getBoundingClientRect();
	const bottom = rect?.bottom ?? y + fontSize * 1.6;
	const gripLeft = x + (width ?? rect?.width ?? 150);

	return (
		<>
			<TextToolbar
				field={ref}
				x={x}
				y={y}
				bottom={bottom}
				format={format}
				onWrap={wrap}
				onLine={line}
			/>
			<TextEditor
				x={x}
				y={y}
				fontSize={fontSize}
				color={color}
				font={font}
				width={width}
				minHeight={minHeight}
				onResize={onResize}
				initialText={initialText}
				onCommit={onCommit}
				onCancel={onCancel}
				inputRef={ref}
			/>
			{onWidth && (
				<div
					class="text-grip"
					role="slider"
					aria-label="Szerokość pola tekstowego"
					aria-valuenow={Math.round(width ?? rect?.width ?? 0)}
					aria-orientation="horizontal"
					tabIndex={-1}
					style={{
						left: `${gripLeft - 7}px`,
						top: `${rect?.top ?? y}px`,
						height: `${rect?.height ?? fontSize * 1.6}px`,
					}}
					onMouseDown={(e) => e.preventDefault()}
					onTouchStart={(e) => e.preventDefault()}
					onPointerDown={(e) => {
						e.preventDefault();
						e.currentTarget.setPointerCapture(e.pointerId);
					}}
					onPointerMove={(e) => {
						if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
						onWidth(Math.max(MIN_FIELD, e.clientX - x), false);
					}}
					onPointerUp={(e) => {
						if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
						e.currentTarget.releasePointerCapture(e.pointerId);
						onWidth(Math.max(MIN_FIELD, e.clientX - x), true);
						ref.current?.focus();
					}}
				>
					<span class="text-grip-pill" />
				</div>
			)}
		</>
	);
}
