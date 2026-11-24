import { useEffect, useRef, useState } from "preact/hooks";
import { TextEditor } from "./text-editor";

interface TextEditorProps {
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

interface MarkdownTextEditorProps extends Omit<TextEditorProps, "onCommit"> {
	/** Called when text is committed with the markdown content */
	onCommit: (text: string) => void;
	/** Whether to show the markdown help initially */
	showHelpInitially?: boolean;
}

/**
 * Enhanced text editor with simplified Markdown support (R-044 compatible).
 * Supports: **bold**, *italic*, ~~strikethrough~~, `code`, - lists, 1. numbered lists
 * No images support as per user request.
 */
export function MarkdownTextEditor({
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
	showHelpInitially = false,
}: MarkdownTextEditorProps) {
	const [showHelp, setShowHelp] = useState(showHelpInitially);
	const [text, setText] = useState(initialText ?? "");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const helpButtonRef = useRef<HTMLButtonElement>(null);

	// Format text with markdown tags at cursor position
	const formatText = (
		prefix: string,
		suffix: string = prefix,
		replaceSelection = true,
	) => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selectedText = textarea.value.substring(start, end);
		const before = textarea.value.substring(0, start);
		const after = textarea.value.substring(end);

		let newText: string;
		let newCursorStart: number;
		let newCursorEnd: number;

		if (selectedText.length > 0 && replaceSelection) {
			// Wrap selected text
			newText = before + prefix + selectedText + suffix + after;
			newCursorStart = start + prefix.length;
			newCursorEnd = end + prefix.length;
		} else {
			// Insert empty tags at cursor
			newText = before + prefix + suffix + after;
			newCursorStart = start + prefix.length;
			newCursorEnd = start + prefix.length;
		}

		setText(newText);
		// Update textarea value directly
		textarea.value = newText;
		textarea.selectionStart = newCursorStart;
		textarea.selectionEnd = newCursorEnd;
		textarea.focus();
	};

	// Toggle help visibility
	const toggleHelp = (e: MouseEvent | TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setShowHelp(!showHelp);
	};

	// Close help when clicking outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent | TouchEvent) => {
			const target = e.target as HTMLElement;
			if (
				showHelp &&
				!target.closest?.(".markdown-help") &&
				!target.closest?.(".markdown-help-btn")
			) {
				setShowHelp(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("touchstart", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("touchstart", handleClickOutside);
		};
	}, [showHelp]);

	// Position help popup near the button
	const [helpPosition, setHelpPosition] = useState<{
		top: number;
		left: number;
	} | null>(null);

	const updateHelpPosition = () => {
		if (!helpButtonRef.current || !showHelp) {
			setHelpPosition(null);
			return;
		}

		const buttonRect = helpButtonRef.current.getBoundingClientRect();
		const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
		const scrollY = window.pageYOffset || document.documentElement.scrollTop;

		// Position help above the button if there's room, otherwise below
		const windowHeight = window.innerHeight;
		const buttonTop = buttonRect.top + scrollY;
		const helpHeight = 280; // Approximate height

		let top: number;

		if (buttonTop - helpHeight > 10) {
			// Above the button
			top = buttonRect.top + scrollY - helpHeight - 8;
		} else {
			// Below the button
			top = buttonRect.top + scrollY + buttonRect.height + 8;
		}

		// Keep within viewport
		if (top + helpHeight > windowHeight + scrollY) {
			top = windowHeight + scrollY - helpHeight - 10;
		}

		// Left align with button
		const left = buttonRect.left + scrollX;

		setHelpPosition({ top, left });
	};

	// Update position when help is shown or window is resized
	useEffect(() => {
		if (showHelp) {
			updateHelpPosition();
			const resizeListener = () => updateHelpPosition();
			window.addEventListener("resize", resizeListener);
			return () => window.removeEventListener("resize", resizeListener);
		}
	}, [showHelp]);

	// Set initial text
	useEffect(() => {
		if (initialText !== undefined && text === "" && initialText !== "") {
			setText(initialText);
		}
	}, [initialText, text]);

	return (
		<>
			{/* Help button - positioned near the text editor */}
			<button
				type="button"
				ref={helpButtonRef}
				class="markdown-help-btn"
				aria-label="Pokaż pomoc Markdown"
				title="Pokaż pomoc Markdown"
				onClick={toggleHelp}
				style={{
					position: "fixed",
					zIndex: 3,
					left: `${x + (width ? width : 150) + 8}px`,
					top: `${y}px`,
					width: "28px",
					height: "28px",
					minWidth: "28px",
					padding: "0",
					border: "1px solid var(--border)",
					borderRadius: "var(--radius)",
					background: "var(--surface)",
					color: "var(--icon)",
					cursor: "pointer",
					fontSize: "16px",
					lineHeight: "1",
				}}
			>
				?
			</button>

			{/* Help popup */}
			{showHelp && helpPosition && (
				<div
					class="markdown-help"
					style={{
						position: "fixed",
						zIndex: 100,
						top: `${helpPosition.top}px`,
						left: `${helpPosition.left}px`,
						width: "280px",
						padding: "12px",
						border: "1px solid var(--border)",
						borderRadius: "var(--radius-lg)",
						background: "var(--surface)",
						boxShadow: "var(--shadow)",
						fontSize: "13px",
					}}
					data-theme="light"
				>
					<div class="markdown-help-header">
						<strong>Składnia Markdown</strong>
						<button
							type="button"
							class="markdown-help-close"
							onClick={(e: MouseEvent) => {
								e.preventDefault();
								setShowHelp(false);
							}}
							aria-label="Zamknij"
						>
							×
						</button>
					</div>

					<ul class="markdown-help-list">
						<li>
							<strong>Pogrubienie:</strong> <code>**tekst**</code> →{" "}
							<strong>tekst</strong>
						</li>
						<li>
							<em>Kursywa:</em> <code>*tekst*</code> → <em>tekst</em>
						</li>
						<li>
							<s>Przekreślenie:</s> <code>~~tekst~~</code> → <s>tekst</s>
						</li>
						<li>
							<code>Kod:</code> <code>`tekst`</code> → <code>tekst</code>
						</li>
						<li>
							Nagłówek 1: <code># Nagłówek</code>
						</li>
						<li>
							Nagłówek 2: <code>## Nagłówek</code>
						</li>
						<li>
							Lista: <code>- element</code>
						</li>
						<li>
							Lista numerowana: <code>1. element</code>
						</li>
						<li>
							Linia pozioma: <code>---</code>
						</li>
						<li>
							Link: <code>[tekst](https://przyklad.com)</code>
						</li>
					</ul>

					<div class="markdown-help-footer">
						<small>
							Skróty: <kbd>Ctrl+B</kbd> pogrubienie, <kbd>Ctrl+I</kbd> kursywa,{" "}
							<kbd>Ctrl+D</kbd> przekreślenie, <kbd>Ctrl+E</kbd> kod
						</small>
					</div>
				</div>
			)}

			{/* Markdown formatting toolbar */}
			<div
				class="markdown-toolbar"
				style={{
					position: "fixed",
					zIndex: 2,
					left: `${x}px`,
					top: `${y - 36}px`,
					display: "flex",
					gap: "2px",
					padding: "4px",
					border: "1px solid var(--border)",
					borderRadius: "var(--radius)",
					background: "color-mix(in srgb, var(--surface) 90%, transparent)",
					backdropFilter: "blur(8px)",
					boxShadow: "var(--shadow)",
				}}
			>
				<button
					type="button"
					title="Pogrubienie (Ctrl+B)"
					aria-label="Pogrubienie"
					onClick={() => formatText("**", "**")}
					class="markdown-toolbar-btn"
				>
					<strong>B</strong>
				</button>
				<button
					type="button"
					title="Kursywa (Ctrl+I)"
					aria-label="Kursywa"
					onClick={() => formatText("*", "*")}
					class="markdown-toolbar-btn"
				>
					<em>I</em>
				</button>
				<button
					type="button"
					title="Przekreślenie (Ctrl+D)"
					aria-label="Przekreślenie"
					onClick={() => formatText("~~", "~~")}
					class="markdown-toolbar-btn"
				>
					<s>S</s>
				</button>
				<button
					type="button"
					title="Kod (Ctrl+E)"
					aria-label="Kod"
					onClick={() => formatText("`", "`")}
					class="markdown-toolbar-btn"
				>
					<code>`</code>
				</button>
				<button
					type="button"
					title="Lista"
					aria-label="Lista"
					onClick={() => formatText("- ", "", false)}
					class="markdown-toolbar-btn"
				>
					-
				</button>
				<button
					type="button"
					title="Nagłówek 1"
					aria-label="Nagłówek 1"
					onClick={() => {
						const textarea = textareaRef.current;
						if (!textarea) return;
						const start = textarea.selectionStart;
						const lineStart =
							textarea.value.substring(0, start).lastIndexOf("\n") + 1;
						let lineEnd = textarea.value.indexOf("\n", start);
						if (lineEnd === -1) lineEnd = textarea.value.length;

						// Add # at the beginning of the line
						const before = textarea.value.substring(0, lineStart);
						const after = textarea.value.substring(lineStart, lineEnd);
						const rest = textarea.value.substring(lineEnd);
						const newText = `${before}# ${after}${rest}`;

						setText(newText);
						textarea.value = newText;
						textarea.selectionStart = lineStart + 2;
						textarea.selectionEnd = lineStart + 2;
						textarea.focus();
					}}
					class="markdown-toolbar-btn"
				>
					<strong>H1</strong>
				</button>
				<button
					type="button"
					title="Nagłówek 2"
					aria-label="Nagłówek 2"
					onClick={() => {
						const textarea = textareaRef.current;
						if (!textarea) return;
						const start = textarea.selectionStart;
						const lineStart =
							textarea.value.substring(0, start).lastIndexOf("\n") + 1;
						let lineEnd = textarea.value.indexOf("\n", start);
						if (lineEnd === -1) lineEnd = textarea.value.length;

						// Add ## at the beginning of the line
						const before = textarea.value.substring(0, lineStart);
						const after = textarea.value.substring(lineStart, lineEnd);
						const rest = textarea.value.substring(lineEnd);
						const newText = `${before}## ${after}${rest}`;

						setText(newText);
						textarea.value = newText;
						textarea.selectionStart = lineStart + 3;
						textarea.selectionEnd = lineStart + 3;
						textarea.focus();
					}}
					class="markdown-toolbar-btn"
				>
					<strong>H2</strong>
				</button>
			</div>

			{/* Actual text editor */}
			<TextEditor
				x={x}
				y={y}
				fontSize={fontSize}
				color={color}
				width={width}
				minHeight={minHeight}
				onResize={onResize}
				initialText={initialText}
				onCommit={onCommit}
				onCancel={onCancel}
			/>
		</>
	);
}
