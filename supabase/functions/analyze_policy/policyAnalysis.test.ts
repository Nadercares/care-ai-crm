import { describe, expect, it } from "vitest";
import {
  ANALYSIS_DISCLAIMER,
  buildMessages,
  buildUserPrompt,
  MAX_POLICY_CHARS,
  normalizeState,
  parsePolicyAnalysis,
  validatePolicyInput,
} from "./policyAnalysis";

const longText = "x".repeat(200);

describe("normalizeState", () => {
  it("maps full state names to a 2-letter code", () => {
    expect(normalizeState("Florida")).toBe("FL");
    expect(normalizeState("  new york ")).toBe("NY");
    expect(normalizeState("DISTRICT OF COLUMBIA")).toBe("DC");
  });

  it("accepts and uppercases valid abbreviations", () => {
    expect(normalizeState("fl")).toBe("FL");
    expect(normalizeState("TX")).toBe("TX");
  });

  it("returns null for unknown or empty input", () => {
    expect(normalizeState("Atlantis")).toBeNull();
    expect(normalizeState("ZZ")).toBeNull();
    expect(normalizeState("")).toBeNull();
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState(undefined)).toBeNull();
  });
});

describe("validatePolicyInput", () => {
  it("accepts a well-formed payload", () => {
    expect(validatePolicyInput({ policyText: longText })).toBeNull();
    expect(
      validatePolicyInput({
        policyText: longText,
        carrier: "Allstate",
        state: "FL",
      }),
    ).toBeNull();
  });

  it("rejects non-object bodies", () => {
    expect(validatePolicyInput(null)).toMatch(/JSON object/);
    expect(validatePolicyInput("text")).toMatch(/JSON object/);
    expect(validatePolicyInput([])).toMatch(/JSON object/);
  });

  it("requires policyText", () => {
    expect(validatePolicyInput({})).toMatch(/policyText is required/);
    expect(validatePolicyInput({ policyText: "   " })).toMatch(/required/);
  });

  it("rejects policyText that is too short or too long", () => {
    expect(validatePolicyInput({ policyText: "too short" })).toMatch(
      /too short/,
    );
    expect(
      validatePolicyInput({ policyText: "x".repeat(MAX_POLICY_CHARS + 1) }),
    ).toMatch(/maximum length/);
  });

  it("rejects non-string carrier or state", () => {
    expect(validatePolicyInput({ policyText: longText, carrier: 5 })).toMatch(
      /carrier must be a string/,
    );
    expect(validatePolicyInput({ policyText: longText, state: {} })).toMatch(
      /state must be a string/,
    );
  });
});

describe("buildUserPrompt / buildMessages", () => {
  it("includes the policy text and optional context", () => {
    const prompt = buildUserPrompt({
      policyText: "POLICY BODY",
      carrier: "State Farm",
      state: "florida",
    });
    expect(prompt).toContain("POLICY BODY");
    expect(prompt).toContain("State Farm");
    expect(prompt).toContain("FL");
  });

  it("omits context lines when carrier and state are absent", () => {
    const prompt = buildUserPrompt({ policyText: "POLICY BODY" });
    expect(prompt).not.toContain("Known carrier");
    expect(prompt).not.toContain("Governing state");
  });

  it("produces a system + user message pair", () => {
    const messages = buildMessages({ policyText: "POLICY BODY" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });
});

describe("parsePolicyAnalysis", () => {
  it("parses a complete JSON response", () => {
    const result = parsePolicyAnalysis(
      JSON.stringify({
        carrier: "Citizens",
        policyNumber: "HO-12345",
        policyForm: "HO-3",
        state: "Florida",
        namedInsured: "Jane Doe",
        effectiveDate: "2025-01-01",
        expirationDate: "2026-01-01",
        coverages: [
          { name: "Dwelling", limit: "$300,000", description: "Coverage A" },
        ],
        deductibles: [{ name: "Hurricane", amount: "2%", basis: "percentage" }],
        sublimits: [{ name: "Jewelry", limit: "$1,500" }],
        exclusions: [{ name: "Flood", description: "Surface water excluded" }],
        endorsements: [
          {
            name: "Ordinance or Law",
            formNumber: "HO-04-77",
            effect: "Adds 10%",
          },
        ],
        notableConditions: ["Appraisal clause present"],
        summary: "Standard HO-3 homeowners policy.",
        bestPracticeNotes: ["Consider invoking appraisal"],
        complianceFlags: ["Verify FL proof-of-loss deadline"],
      }),
    );
    expect(result.carrier).toBe("Citizens");
    expect(result.state).toBe("FL");
    expect(result.coverages[0].limit).toBe("$300,000");
    expect(result.deductibles[0].basis).toBe("percentage");
    expect(result.notableConditions).toEqual(["Appraisal clause present"]);
  });

  it("strips markdown code fences", () => {
    const result = parsePolicyAnalysis(
      '```json\n{"carrier":"Allstate","summary":"ok"}\n```',
    );
    expect(result.carrier).toBe("Allstate");
    expect(result.summary).toBe("ok");
  });

  it("recovers a JSON object surrounded by prose", () => {
    const result = parsePolicyAnalysis(
      'Here is the analysis: {"carrier":"USAA"} — let me know if you need more.',
    );
    expect(result.carrier).toBe("USAA");
  });

  it("defaults missing fields and always enforces review framing", () => {
    const result = parsePolicyAnalysis("{}");
    expect(result.coverages).toEqual([]);
    expect(result.exclusions).toEqual([]);
    expect(result.summary).toBe("");
    expect(result.carrier).toBeNull();
    expect(result.reviewRequired).toBe(true);
    expect(result.disclaimer).toBe(ANALYSIS_DISCLAIMER);
  });

  it("infers deductible basis when the model omits it", () => {
    const result = parsePolicyAnalysis(
      JSON.stringify({ deductibles: [{ name: "AOP", amount: "$2,500" }] }),
    );
    expect(result.deductibles[0].basis).toBe("flat");
  });

  it("ignores malformed array entries", () => {
    const result = parsePolicyAnalysis(
      JSON.stringify({
        coverages: ["not an object", null, 5],
        notableConditions: ["keep this", null, "and this"],
      }),
    );
    expect(result.coverages).toEqual([]);
    expect(result.notableConditions).toEqual(["keep this", "and this"]);
  });

  it("throws when no JSON object is present", () => {
    expect(() => parsePolicyAnalysis("the model refused")).toThrow(
      /No JSON object/,
    );
  });

  it("throws on malformed JSON", () => {
    expect(() => parsePolicyAnalysis('{"carrier": }')).toThrow(
      /Could not parse/,
    );
  });
});
