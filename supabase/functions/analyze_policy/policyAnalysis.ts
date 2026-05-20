// Pure, runtime-agnostic logic for the analyze_policy edge function.
// This file MUST stay free of Deno/jsr imports so it can be unit-tested
// under Vitest (Node) via vitest.functions.config.ts.

export interface PolicyAnalysisInput {
  policyText: string;
  carrier?: string | null;
  state?: string | null;
}

export interface CoverageItem {
  name: string;
  limit: string | null;
  description: string | null;
}

export interface DeductibleItem {
  name: string;
  amount: string | null;
  basis: "flat" | "percentage" | "unknown";
}

export interface SublimitItem {
  name: string;
  limit: string | null;
}

export interface ExclusionItem {
  name: string;
  description: string | null;
}

export interface EndorsementItem {
  name: string;
  formNumber: string | null;
  effect: string | null;
}

export interface PolicyAnalysis {
  carrier: string | null;
  policyNumber: string | null;
  policyForm: string | null;
  state: string | null;
  namedInsured: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverages: CoverageItem[];
  deductibles: DeductibleItem[];
  sublimits: SublimitItem[];
  exclusions: ExclusionItem[];
  endorsements: EndorsementItem[];
  notableConditions: string[];
  summary: string;
  bestPracticeNotes: string[];
  complianceFlags: string[];
  reviewRequired: boolean;
  disclaimer: string;
}

export const MIN_POLICY_CHARS = 50;
export const MAX_POLICY_CHARS = 100_000;

// Shown on every result. A public adjuster must own the final interpretation —
// the model is a drafting aid, not a coverage determination or legal advice.
export const ANALYSIS_DISCLAIMER =
  "AI-generated analysis for internal use by a licensed public adjuster. It is " +
  "decision-support only — not legal advice and not a coverage determination. A " +
  "licensed adjuster must independently verify every item against the full policy " +
  "and the applicable state's statutes and Department of Insurance regulations " +
  "before relying on it.";

export const SYSTEM_PROMPT = `You are a policy-analysis assistant for a licensed public adjusting firm that advocates for policyholders on first-party insurance claims across all 50 U.S. states. You support the firm's licensed adjusters; you never replace their judgment.

Read the insurance policy text the user provides and return a STRUCTURED, OBJECTIVE breakdown of it.

Extract:
- Identifying info: carrier, policy number, policy form/edition, named insured, effective and expiration dates, and the U.S. state whose law governs the policy.
- coverages: each coverage part with its limit and a short description.
- deductibles: every deductible, its amount, and whether it is a flat dollar amount or a percentage.
- sublimits: sub-limits that cap specific perils or property types.
- exclusions: significant exclusions, each with a short plain-language description.
- endorsements: each endorsement/rider with its form number and how it changes coverage.
- notableConditions: claim-critical conditions such as appraisal clauses, examination-under-oath (EUO) requirements, proof-of-loss deadlines, suit-limitation periods, duties after loss, and notice requirements.

Then provide:
- summary: a concise plain-language overview of what the policy covers and its key limitations.
- bestPracticeNotes: practical, claim-resolution-oriented considerations a public adjuster could weigh, taking the governing state into account when known. Frame them as considerations, not directives.
- complianceFlags: items the firm must independently verify against the claim's state law and Department of Insurance regulations (e.g. statutory deadlines, prohibited clauses, mandatory disclosures, appraisal/mediation rules). Identify what must be checked; do NOT assert what the law is.

Rules:
- Base every statement on the provided policy text. If something is not in the text, use null or note the gap — never invent coverage, limits, or terms.
- Do not give legal advice or make a binding coverage determination.
- Be precise: quote limits, deductibles, and dates exactly as written.
- Respond with ONLY a single JSON object, no prose and no markdown fences, matching:
{
  "carrier": string|null, "policyNumber": string|null, "policyForm": string|null,
  "state": string|null, "namedInsured": string|null,
  "effectiveDate": string|null, "expirationDate": string|null,
  "coverages": [{ "name": string, "limit": string|null, "description": string|null }],
  "deductibles": [{ "name": string, "amount": string|null, "basis": "flat"|"percentage"|"unknown" }],
  "sublimits": [{ "name": string, "limit": string|null }],
  "exclusions": [{ "name": string, "description": string|null }],
  "endorsements": [{ "name": string, "formNumber": string|null, "effect": string|null }],
  "notableConditions": [string],
  "summary": string,
  "bestPracticeNotes": [string],
  "complianceFlags": [string]
}`;

const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const STATE_ABBRS = new Set(Object.values(US_STATES));

/** Normalize a state name or abbreviation to a 2-letter code, or null if unknown. */
export function normalizeState(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (key === "") return null;
  if (key.length === 2 && STATE_ABBRS.has(key.toUpperCase())) {
    return key.toUpperCase();
  }
  return US_STATES[key] ?? null;
}

/** Validate the request payload. Returns an error message, or null when valid. */
export function validatePolicyInput(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Request body must be a JSON object";
  }
  const { policyText, carrier, state } = input as Record<string, unknown>;
  if (typeof policyText !== "string" || policyText.trim().length === 0) {
    return "policyText is required";
  }
  if (policyText.trim().length < MIN_POLICY_CHARS) {
    return `policyText is too short to analyze (minimum ${MIN_POLICY_CHARS} characters)`;
  }
  if (policyText.length > MAX_POLICY_CHARS) {
    return `policyText exceeds the maximum length of ${MAX_POLICY_CHARS} characters`;
  }
  if (carrier != null && typeof carrier !== "string") {
    return "carrier must be a string";
  }
  if (state != null && typeof state !== "string") {
    return "state must be a string";
  }
  return null;
}

export function buildUserPrompt(input: PolicyAnalysisInput): string {
  const parts: string[] = [];
  const carrier = input.carrier?.trim();
  const state = input.state?.trim();
  if (carrier) {
    parts.push(
      `Known carrier (context only — verify against the text): ${carrier}`,
    );
  }
  if (state) {
    const normalized = normalizeState(state);
    parts.push(
      `Governing state for this claim: ${normalized ?? state}. Tailor ` +
        `bestPracticeNotes and complianceFlags to this state.`,
    );
  }
  parts.push(
    "Analyze the following insurance policy text and respond with the JSON object only:",
  );
  parts.push("---");
  parts.push(input.policyText.trim());
  return parts.join("\n");
}

export function buildMessages(input: PolicyAnalysisInput) {
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserPrompt(input) },
  ];
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item): item is string => item !== null);
}

function asObjectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function coerceBasis(
  basis: unknown,
  amount: unknown,
): "flat" | "percentage" | "unknown" {
  const b = (typeof basis === "string" ? basis : "").toLowerCase();
  const a = typeof amount === "string" ? amount : "";
  if (b.includes("percent") || b.includes("%") || a.includes("%")) {
    return "percentage";
  }
  if (b.includes("flat") || b.includes("fixed") || b.includes("dollar")) {
    return "flat";
  }
  if (a.includes("$")) return "flat";
  return "unknown";
}

function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in the model response");
  }
  return text.slice(start, end + 1);
}

/**
 * Parse a model completion into a PolicyAnalysis. Tolerates missing fields and
 * markdown fences, but throws if no JSON object can be recovered. The disclaimer
 * and reviewRequired flag are always enforced regardless of model output.
 */
export function parsePolicyAnalysis(raw: string): PolicyAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (error) {
    throw new Error(
      `Could not parse policy analysis JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Policy analysis response was not a JSON object");
  }
  const o = parsed as Record<string, unknown>;

  return {
    carrier: asString(o.carrier),
    policyNumber: asString(o.policyNumber),
    policyForm: asString(o.policyForm),
    state: normalizeState(asString(o.state)),
    namedInsured: asString(o.namedInsured),
    effectiveDate: asString(o.effectiveDate),
    expirationDate: asString(o.expirationDate),
    coverages: asObjectList(o.coverages).map((c) => ({
      name: asString(c.name) ?? "Unnamed coverage",
      limit: asString(c.limit),
      description: asString(c.description),
    })),
    deductibles: asObjectList(o.deductibles).map((d) => ({
      name: asString(d.name) ?? "Deductible",
      amount: asString(d.amount),
      basis: coerceBasis(d.basis, d.amount),
    })),
    sublimits: asObjectList(o.sublimits).map((s) => ({
      name: asString(s.name) ?? "Sublimit",
      limit: asString(s.limit),
    })),
    exclusions: asObjectList(o.exclusions).map((e) => ({
      name: asString(e.name) ?? "Exclusion",
      description: asString(e.description),
    })),
    endorsements: asObjectList(o.endorsements).map((e) => ({
      name: asString(e.name) ?? "Endorsement",
      formNumber: asString(e.formNumber),
      effect: asString(e.effect),
    })),
    notableConditions: asStringList(o.notableConditions),
    summary: asString(o.summary) ?? "",
    bestPracticeNotes: asStringList(o.bestPracticeNotes),
    complianceFlags: asStringList(o.complianceFlags),
    reviewRequired: true,
    disclaimer: ANALYSIS_DISCLAIMER,
  };
}
