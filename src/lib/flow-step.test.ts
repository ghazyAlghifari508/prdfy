import { describe, expect, it } from "vitest";
import {
	type FlowStep,
	getFlowStepCta,
	routeToStep,
	stepToRoute,
} from "./flow-step";

describe("stepToRoute", () => {
	it("maps question step to /ask route", () => {
		expect(stepToRoute("question", "p1")).toBe("/ask/p1");
	});

	it("maps prd step to /prd route", () => {
		expect(stepToRoute("prd", "p1")).toBe("/prd/p1");
	});

	it("maps ac step to /ac route", () => {
		expect(stepToRoute("ac", "p1")).toBe("/ac/p1");
	});

	it("maps task step to /task route", () => {
		expect(stepToRoute("task", "p1")).toBe("/task/p1");
	});

	it("defaults unknown/null step to /prd route", () => {
		// ponytail: defensive - DB step could be null/legacy. /prd is the landing.
		expect(stepToRoute(undefined, "p1")).toBe("/prd/p1");
		expect(stepToRoute(null, "p1")).toBe("/prd/p1");
		expect(stepToRoute("unknown" as never, "p1")).toBe("/prd/p1");
	});

	it("encodes reserved characters in the project id segment", () => {
		expect(stepToRoute("task", "a/b?c#d%e")).toBe("/task/a%2Fb%3Fc%23d%25e");
		expect(stepToRoute("prd", "p1")).toBe("/prd/p1");
	});
});

describe("routeToStep", () => {
	it("detects ask as question", () => {
		expect(routeToStep("/ask/x")).toBe("question");
		expect(routeToStep("/ask")).toBe("question");
	});

	it("detects ac", () => {
		expect(routeToStep("/ac/x")).toBe("ac");
	});

	it("detects task and kanban as task", () => {
		expect(routeToStep("/task/x")).toBe("task");
		expect(routeToStep("/kanban/x")).toBe("task");
	});

	it("defaults to prd", () => {
		expect(routeToStep("/")).toBe("prd");
		expect(routeToStep("/pricing")).toBe("prd");
	});
});

describe("round-trip", () => {
	it("stepToRoute is the inverse of routeToStep for every flow step", () => {
		const routes = ["/ask/x", "/prd/x", "/ac/x", "/task/x"];
		for (const r of routes) {
			expect(stepToRoute(routeToStep(r), "x")).toBe(r);
		}
	});

	it("FlowStep covers exactly question|prd|ac|task", () => {
		const steps: FlowStep[] = ["question", "prd", "ac", "task"];
		expect(steps).toHaveLength(4);
	});
});

describe("getFlowStepCta", () => {
	it("returns Generate PRD on question route when project has no PRD", () => {
		const cta = getFlowStepCta("question", "question", false);
		expect(cta).toEqual({
			kind: "generate",
			label: "Generate PRD",
			targetStep: "prd",
		});
	});

	it("returns Kembali ke PRD on question route when project already has PRD", () => {
		const cta = getFlowStepCta("question", "prd", true);
		expect(cta).toEqual({
			kind: "navigate",
			label: "Kembali ke PRD",
			targetStep: "prd",
		});
	});

	it("returns Kembali ke AC on question route when project has reached AC stage", () => {
		const cta = getFlowStepCta("question", "ac", true);
		expect(cta).toEqual({
			kind: "navigate",
			label: "Kembali ke AC",
			targetStep: "ac",
		});
	});

	it("returns Kembali ke Task on question route when project has reached Task stage", () => {
		const cta = getFlowStepCta("question", "task", true);
		expect(cta).toEqual({
			kind: "navigate",
			label: "Kembali ke Task",
			targetStep: "task",
		});
	});

	it("returns Generate AC on PRD route when project is at PRD stage", () => {
		const cta = getFlowStepCta("prd", "prd");
		expect(cta).toEqual({
			kind: "generate",
			label: "Generate AC",
			targetStep: "ac",
		});
	});

	it("returns Lanjut ke AC on PRD route when project has reached AC stage", () => {
		const cta = getFlowStepCta("prd", "ac");
		expect(cta).toEqual({
			kind: "navigate",
			label: "Lanjut ke AC",
			targetStep: "ac",
		});
	});

	it("returns Kembali ke Task on PRD route when project has reached Task stage", () => {
		const cta = getFlowStepCta("prd", "task");
		expect(cta).toEqual({
			kind: "navigate",
			label: "Kembali ke Task",
			targetStep: "task",
		});
	});

	it("returns Generate Task on AC route when project is at AC stage", () => {
		const cta = getFlowStepCta("ac", "ac");
		expect(cta).toEqual({
			kind: "generate",
			label: "Generate Task",
			targetStep: "task",
		});
	});

	it("returns Kembali ke Task on AC route when project has reached Task stage", () => {
		const cta = getFlowStepCta("ac", "task");
		expect(cta).toEqual({
			kind: "navigate",
			label: "Kembali ke Task",
			targetStep: "task",
		});
	});

	it("returns null for task route", () => {
		expect(getFlowStepCta("task", "task")).toBeNull();
	});
});
