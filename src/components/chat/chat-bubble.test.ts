import { describe, expect, it } from "vitest";
import { cleanMessage } from "./chat-bubble";

describe("cleanMessage", () => {
	it("strips complete update blocks but keeps surrounding text", () => {
		expect(
			cleanMessage(
				"Halo :::UPDATE_SECTION[Ringkasan]::: isi baru :::END_UPDATE::: selesai",
			),
		).toBe("Halo  selesai");
	});

	it("preserves an unterminated block and the text after it", () => {
		const content =
			"Ringkasan awal :::UPDATE_SECTION[Ringkasan]::: potongan belum selesai";
		expect(cleanMessage(content)).toBe(content);
	});

	it("summarizes a message that only contains a complete block", () => {
		expect(
			cleanMessage(":::UPDATE_SECTION[Ringkasan]::: isi :::END_UPDATE:::"),
		).toBe("Telah merevisi dokumen PRD.");
	});
});
