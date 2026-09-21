/**
 * Export service - pure formatters + ZIP generation.
 * Copied as-is from old project (no InsForge deps).
 */
import type { TaskTree } from "./task-service";

export function formatPrdMarkdown(prdContent: string): string {
	return prdContent;
}

export function formatAcMarkdown(acContent: string): string {
	return acContent;
}

export function formatTasksJson(taskTree: TaskTree | null): string {
	if (!taskTree) return JSON.stringify({ features: [] }, null, 2);
	return JSON.stringify(taskTree, null, 2);
}

export async function generateZipBuffer(files: {
	prd?: string;
	ac?: string;
	tasks?: string;
}): Promise<Buffer> {
	// Presence (not truthiness) decides inclusion: an intentionally empty
	// document must still export as an empty file.
	try {
		const { default: JSZip } = await import("jszip");
		const zip = new JSZip();
		if (files.prd !== undefined) zip.file("prd.md", files.prd);
		if (files.ac !== undefined) zip.file("ac.md", files.ac);
		if (files.tasks !== undefined) zip.file("tasks.json", files.tasks);
		return await zip.generateAsync({ type: "nodebuffer" });
	} catch (e) {
		throw new Error("Gagal membuat arsip ZIP.", { cause: e });
	}
}
