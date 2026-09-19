import { describe, expect, it } from "vitest";
import { decideCodebaseEntry } from "./$id";

describe("decideCodebaseEntry", () => {
	it("allows existing-codebase projects to enter", () => {
		expect(decideCodebaseEntry("existing_codebase")).toBe("allow");
	});

	it("denies greenfield projects from entering", () => {
		expect(decideCodebaseEntry("greenfield")).toBe("deny");
	});

	it("denies missing or unknown modes", () => {
		expect(decideCodebaseEntry(null)).toBe("deny");
		expect(decideCodebaseEntry(undefined)).toBe("deny");
		expect(decideCodebaseEntry("unknown")).toBe("deny");
	});
});
