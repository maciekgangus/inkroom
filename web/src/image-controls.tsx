import { useRef } from "preact/hooks";
import { Icon } from "./icon";

export interface ImageControlsProps {
	/** A mouse-like main pointer (a PC): the context menu offers paste and delete instead. */
	fine: boolean;
	hasSelection: boolean;
	/** True where the browser lets us read the clipboard (HTTPS or localhost). */
	canPaste: boolean;
	onFile: (file: File) => void;
	onPaste: () => void;
	onDelete: () => void;
}

/**
 * A group of the main toolbar: add an image from a file; on a tablet, which has no right
 * click, also paste an image and delete the selection.
 */
export function ImageControls({
	fine,
	hasSelection,
	canPaste,
	onFile,
	onPaste,
	onDelete,
}: ImageControlsProps) {
	const input = useRef<HTMLInputElement>(null);

	return (
		<div class="group">
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
				title="Obraz z pliku"
				onClick={() => input.current?.click()}
			>
				<Icon name="image" />
			</button>
			{!fine && canPaste && (
				<button
					type="button"
					aria-label="paste image"
					title="Wklej obraz"
					onClick={onPaste}
				>
					<Icon name="paste" />
				</button>
			)}
			{!fine && hasSelection && (
				<button
					type="button"
					aria-label="delete selection"
					title="Usuń"
					onClick={onDelete}
				>
					<Icon name="trash" />
				</button>
			)}
		</div>
	);
}
