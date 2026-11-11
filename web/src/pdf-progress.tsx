/** The bar shown while a PDF is being put on the board, with a way to stop it (R-056). */
export function PdfProgress({
	done,
	total,
	onCancel,
}: {
	done: number;
	total: number;
	onCancel: () => void;
}) {
	return (
		<div class="toast notice pdf-progress" role="status">
			{total === 0 ? (
				<span>Otwieranie PDF…</span>
			) : (
				<>
					<span>
						Wczytywanie PDF: strona {Math.min(done + 1, total)} z {total}
					</span>
					<progress value={done} max={total} />
				</>
			)}
			<button type="button" onClick={onCancel}>
				Anuluj
			</button>
		</div>
	);
}
