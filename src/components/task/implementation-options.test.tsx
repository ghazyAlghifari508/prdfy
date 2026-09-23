import { describe, expect, it } from "vitest";
import {
	AI_AGENT_PROMPT_TEMPLATE,
	shouldConfirmReset,
} from "./implementation-options";

describe("shouldConfirmReset", () => {
	it("asks for confirmation when progress exists", () => {
		expect(shouldConfirmReset(true)).toBe(true);
	});

	it("skips confirmation when nothing has been worked on", () => {
		expect(shouldConfirmReset(false)).toBe(false);
	});
});

describe("AI_AGENT_PROMPT_TEMPLATE", () => {
	it("contains rule 9 for decoupled external credentials and tutorial reporting", () => {
		expect(AI_AGENT_PROMPT_TEMPLATE).toContain(
			"PENANGANAN DEPENDENSI & KREDENSIAL EKSTERNAL",
		);
		expect(AI_AGENT_PROMPT_TEMPLATE).toContain(
			"DAFTAR KEBUTUHAN KREDENSIAL EKSTERNAL (AKSI PENGGUNA)",
		);
		expect(AI_AGENT_PROMPT_TEMPLATE).toContain(".env.example");
		expect(AI_AGENT_PROMPT_TEMPLATE).toContain("placeholder");
	});
});
