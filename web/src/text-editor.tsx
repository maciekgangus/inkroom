import { useEffect, useRef } from "preact/hooks";
import { LINE_HEIGHT } from "./board/text";

interface Props {
	/** Screen position of the text's top-left corner. */
	x: number;
	y: number;
	/** Font size in screen pixels (already multiplied by the zoom). */
	fontSize: number;
	color: string;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/** A text field placed on top of the board where a text is being typed. */
export function TextEditor({
	x,
	y,
	fontSize,
	color,
	onCommit,
	onCancel,
}: Props) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	useEffect(() => {
		ref.current?.focus();
	}, []);

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
			class="text-editor"
			aria-label="text editor"
			rows={1}
			style={{
				left: `${x}px`,
				top: `${y}px`,
				fontSize: `${fontSize}px`,
				lineHeight: LINE_HEIGHT,
				color,
			}}
			onInput={(e) => {
				const el = e.currentTarget as HTMLTextAreaElement;
				el.rows = el.value.split("\n").length;
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					finish(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					finish(false);
				}
			}}
			onBlur={() => finish(true)}
		/>
	);
}
