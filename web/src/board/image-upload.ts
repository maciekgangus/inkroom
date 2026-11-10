import { fitWithin } from "./image-geometry";

/** Longest side after shrinking, and the file size below which a small image is sent untouched (ADR 0007). */
export const MAX_SIDE = 2048;
export const KEEP_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** True if the image must be shrunk or converted before upload. */
export function needsReencode(
	type: string,
	bytes: number,
	w: number,
	h: number,
): boolean {
	return (
		!ACCEPTED.includes(type) || bytes > KEEP_BYTES || Math.max(w, h) > MAX_SIDE
	);
}

/**
 * Prepares a picked, pasted or dropped image for upload: small supported images go as they
 * are, everything else is scaled down and re-encoded as JPEG in the browser (saves mobile
 * data, and the server never has to decode images).
 */
export async function prepareImage(
	file: Blob,
): Promise<{ blob: Blob; w: number; h: number }> {
	const bitmap = await createImageBitmap(file);
	const { width, height } = bitmap;
	if (!needsReencode(file.type, file.size, width, height)) {
		bitmap.close();
		return { blob: file, w: width, h: height };
	}
	const size = fitWithin(width, height, MAX_SIDE);
	const canvas = document.createElement("canvas");
	canvas.width = size.w;
	canvas.height = size.h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Nie można przetworzyć obrazu");
	ctx.fillStyle = "#fff"; // JPEG has no transparency
	ctx.fillRect(0, 0, size.w, size.h);
	ctx.drawImage(bitmap, 0, 0, size.w, size.h);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
	);
	if (!blob) throw new Error("Nie można przetworzyć obrazu");
	return { blob, w: size.w, h: size.h };
}

type FetchFn = (
	url: string,
	init: { method: string; body: Blob },
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<{ id?: string; error?: string }>;
}>;

/** Uploads image bytes to a board and returns the image id. */
export async function uploadImage(
	boardId: string,
	blob: Blob,
	fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<string> {
	let res: Awaited<ReturnType<FetchFn>>;
	try {
		res = await fetchFn(`/api/boards/${boardId}/images`, {
			method: "POST",
			body: blob,
		});
	} catch {
		throw new Error("Brak połączenia z serwerem, spróbuj ponownie");
	}
	let data: { id?: string; error?: string } = {};
	try {
		data = await res.json();
	} catch {
		// not JSON: the generic message below is enough
	}
	if (!res.ok || !data.id)
		throw new Error(
			data.error ?? `Nie udało się wysłać obrazu (błąd ${res.status})`,
		);
	return data.id;
}
