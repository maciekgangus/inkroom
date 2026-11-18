import * as api from "./api";
import { exportShortcuts, importShortcuts, setShortcutSync } from "./shortcuts";

/**
 * Keeps the own keyboard shortcuts on the account (R-086), once per page. The account's keys win
 * over this device's; an account with none takes this device's. From then on every change is
 * sent. Any failure leaves the keys of this device as they are.
 */
export async function syncAccountShortcuts(): Promise<void> {
	try {
		const { shortcuts } = await api.getShortcuts();
		if (Object.keys(shortcuts ?? {}).length > 0) importShortcuts(shortcuts);
		else if (Object.keys(exportShortcuts()).length > 0)
			await api.putShortcuts(exportShortcuts());
		setShortcutSync((keys) => {
			api.putShortcuts(keys).catch(() => {});
		});
	} catch {
		// offline or old server: the keys stay on this device
	}
}
