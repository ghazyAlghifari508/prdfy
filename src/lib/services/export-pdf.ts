import { PDF_STYLES } from "@/lib/constants";

// V1: generate simple text-based PDF buffer — pakai jsPDF, dynamic import
export async function generatePdfBuffer({
	content,
	projectName,
}: {
	content: string;
	projectName: string;
}): Promise<Buffer> {
	let doc: {
		setFontSize: (size: number) => void;
		splitTextToSize: (content: string, width: number) => string[];
		text: (lines: string | string[], x: number, y: number) => void;
		addPage: () => void;
		output: (format: "arraybuffer") => ArrayBuffer;
		internal: { pageSize: { getHeight: () => number } };
	};
	try {
		const { jsPDF } = await import("jspdf");
		doc = new jsPDF();
	} catch (e) {
		throw new Error("Gagal membuat PDF.", { cause: e });
	}
	try {
		const bodySize = PDF_STYLES.bodySize;
		doc.setFontSize(PDF_STYLES.headerSize);
		doc.setFontSize(bodySize);
		const lines = doc.splitTextToSize(content, 180);
		const pageHeight = doc.internal.pageSize.getHeight();
		// Derive pagination from the real font metrics instead of a magic
		// constant: jsPDF's default lineHeightFactor (1.15) scales the font size.
		const lineHeight = bodySize * 1.15;
		const bottomMargin = 10;
		const firstPageAvailable = pageHeight - 20 - bottomMargin;
		const otherPageAvailable = pageHeight - 10 - bottomMargin;
		const firstPageLines = Math.floor(firstPageAvailable / lineHeight);
		const otherPageLines = Math.floor(otherPageAvailable / lineHeight);
		let remaining = lines;
		let isFirstPage = true;
		let y = 20;
		while (remaining.length > 0) {
			const chunkSize = isFirstPage ? firstPageLines : otherPageLines;
			const chunk = remaining.slice(0, chunkSize);
			doc.text(chunk, 10, y);
			remaining = remaining.slice(chunkSize);
			if (remaining.length > 0) {
				doc.addPage();
				doc.setFontSize(PDF_STYLES.bodySize);
				y = 10;
				isFirstPage = false;
			}
		}
		const out = doc.output("arraybuffer");
		return Buffer.from(out);
	} catch (e) {
		throw new Error("Gagal membuat PDF.", { cause: e });
	}
}
