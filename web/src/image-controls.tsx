import { useRef, useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import "./image-controls.css";

interface Props {
	settings: Settings;
	hasSelection: boolean;
	/** True where the browser lets us read the clipboard (HTTPS or localhost). */
	canPaste: boolean;
	error: string;
	onFile: (file: File) => void;
	onPaste: () => void;
	onDelete: () => void;
}

/** Adding an image (picker, paste), the select tool and deleting the selected image. */
export function ImageControls({
	settings,
	hasSelection,
	canPaste,
	error,
	onFile,
	onPaste,
	onDelete,
}: Props) {
	const input = useRef<HTMLInputElement>(null);
	const [, rerender] = useState(0);

	return (
		<div class="image-controls">
			<input
				ref={input}
				type="file"
				accept="image/*"
				hidden
				onChange={(e) => {
					const el = e.currentTarget as HTMLInputElement;
					for (const file of Array.from(el.files ?? [])) onFile(file);
					el.value = ""; // so the same file can be picked again
				}}
			/>
			<button
				type="button"
				aria-label="add image"
				onClick={() => input.current?.click()}
			>
				Obraz
			</button>
			{canPaste && (
				<button type="button" aria-label="paste image" onClick={onPaste}>
					Wklej obraz
				</button>
			)}
			<button
				type="button"
				aria-label="select"
				class={settings.tool === "select" ? "active" : ""}
				onClick={() => {
					settings.tool = "select";
					rerender((n) => n + 1);
				}}
			>
				Zaznacz
			</button>
			{hasSelection && (
				<button
					type="button"
					aria-label="delete selection"
					class="danger"
					onClick={onDelete}
				>
					Usuń
				</button>
			)}
			{error && (
				<span class="error" role="alert">
					{error}
				</span>
			)}
		</div>
	);
}
