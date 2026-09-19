import { describe, expect, it } from "vitest";
import { decideAskEntry } from "./$id";

describe("decideAskEntry", () => {
	it("allows greenfield projects without analysis", () => {
		expect(decideAskEntry("greenfield", false)).toBe("allow");
	});

	it("allows greenfield projects with analysis", () => {
		expect(decideAskEntry("greenfield", true)).toBe("allow");
	});

	it("allows existing-codebase projects with ready analysis", () => {
		expect(decideAskEntry("existing_codebase", true)).toBe("allow");
	});

	it("redirects existing-codebase projects without ready analysis to sync", () => {
		expect(decideAskEntry("existing_codebase", false)).toBe(
			"redirect-codebase",
		);
	});

	it("allows missing or unknown modes (greenfield default untouched)", () => {
		expect(decideAskEntry(null, false)).toBe("allow");
		expect(decideAskEntry(undefined, false)).toBe("allow");
		expect(decideAskEntry("unknown", false)).toBe("allow");
	});
});
