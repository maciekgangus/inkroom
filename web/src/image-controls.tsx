import { useRef } from "preact/hooks";
import { Icon } from "./icon";

export interface ImageControlsProps {
	/** A mouse-like main pointer (a PC): the context menu offers paste and delete instead. */
	fine: boolean;
	hasSelection: boolean;
	/** True where the browser lets us read the clipboard (HTTPS or localhost). */
	canPaste: boolean;
	onFile: (file: File) => void;
	/** Given where a PDF may be put on the board: a button right after the image one (R-056). */
	onPdf?: (file: File) => void;
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
	onPdf,
	onPaste,
	onDelete,
}: ImageControlsProps) {
	const input = useRef<HTMLInputElement>(null);
	const pdfInput = useRef<HTMLInputElement>(null);

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
			{onPdf && (
				<>
					<input
						ref={pdfInput}
						type="file"
						accept="application/pdf,.pdf"
						hidden
						aria-label="PDF file"
						onChange={(e) => {
							const el = e.currentTarget as HTMLInputElement;
							const file = el.files?.[0];
							el.value = ""; // so the same file can be picked again
							if (file) onPdf(file);
						}}
					/>
					<button
						type="button"
						aria-label="add pdf"
						title="Wczytaj PDF"
						onClick={() => pdfInput.current?.click()}
					>
						<Icon name="file" />
					</button>
				</>
			)}
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
