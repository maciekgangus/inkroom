/** A valid PDF of `pages` Letter pages, each with a big "Strona N" (plain ASCII, built by hand). */
export function makePdf(pages: number): Buffer {
	const objects: string[] = [];
	const kids = Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(
		" ",
	);
	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`;
	objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
	for (let i = 0; i < pages; i++) {
		const text = `BT /F1 64 Tf 72 700 Td (Strona ${i + 1}) Tj ET`;
		objects[4 + 2 * i] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
		objects[5 + 2 * i] =
			`<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
	}
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let n = 1; n < objects.length; n++) {
		offsets[n] = out.length;
		out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
	}
	const xref = out.length;
	out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
	for (let n = 1; n < objects.length; n++) {
		out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
	}
	out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}
