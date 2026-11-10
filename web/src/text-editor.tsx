import { useEffect, useRef } from "preact/hooks";
import { LINE_HEIGHT } from "./board/text";

interface Props {
	/** Screen position of the text's top-left corner. */
	x: number;
	y: number;
	/** Font size in screen pixels (already multiplied by the zoom). */
	fontSize: number;
	color: string;
	/**
	 * Set for a text area (R-044): the field is that wide (screen px), at least `minHeight` tall,
	 * wraps its text and grows with it. Enter is then a new line, and Escape, Ctrl+Enter or
	 * leaving the field keep the text. Without a width the field is a text at a point: Enter ends
	 * it and Escape throws it away.
	 */
	width?: number;
	minHeight?: number;
	/**
	 * Called when the field of an area changes size (typing, a new font size), so the panel of
	 * tools next to it can follow (R-042).
	 */
	onResize?: () => void;
	/** The existing text when editing one; the field then covers the drawn text. */
	initialText?: string;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/** A text field placed on top of the board where a text is being typed. */
export function TextEditor({
	x,
	y,
	fontSize,
	color,
	width,
	minHeight,
	onResize,
	initialText,
	onCommit,
	onCancel,
}: Props) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	const area = width !== undefined;
	/** An area is as tall as its text, and never shorter than the area that was dragged. */
	const fit = (el: HTMLTextAreaElement) => {
		if (!area) return;
		el.style.height = "auto";
		el.style.height = `${Math.max(el.scrollHeight, minHeight ?? 0)}px`;
		onResize?.();
	};

	useEffect(() => {
		ref.current?.focus();
	}, []);
	// A new font size or width changes how tall the text is.
	// biome-ignore lint/correctness/useExhaustiveDependencies: fit reads the props listed here
	useEffect(() => {
		if (ref.current) fit(ref.current);
	}, [fontSize, width, minHeight]);

	// Enter, Escape and a blur can all arrive for one editing session; only the first counts.
	const finish = (commit: boolean) => {
		if (done.current) return;
		done.current = true;
		if (commit) onCommit(ref.current?.value ?? "");
		else onCancel();
	};

	return (
		<textarea
			ref={ref}
			class={`text-editor${area ? " area" : ""}${initialText === undefined ? "" : " solid"}`}
			defaultValue={initialText}
			aria-label="text editor"
			rows={
				area || initialText === undefined ? 1 : initialText.split("\n").length
			}
			style={{
				left: `${x}px`,
				top: `${y}px`,
				fontSize: `${fontSize}px`,
				lineHeight: LINE_HEIGHT,
				color,
				...(area
					? { width: `${width}px`, minHeight: `${minHeight ?? 0}px` }
					: {}),
			}}
			onInput={(e) => {
				const el = e.currentTarget as HTMLTextAreaElement;
				if (area) fit(el);
				else el.rows = el.value.split("\n").length;
			}}
			onKeyDown={(e) => {
				if (area) {
					if (
						e.key === "Escape" ||
						(e.key === "Enter" && (e.ctrlKey || e.metaKey))
					) {
						e.preventDefault();
						finish(true);
					}
					return; // Enter is a new line
				}
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					finish(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					finish(false);
				}
			}}
			onBlur={(e) => {
				// Moving to the panel of tools next to the field does not end the text.
				const next = e.relatedTarget as HTMLElement | null;
				if (next?.closest?.(".properties")) return;
				finish(true);
			}}
		/>
	);
}
