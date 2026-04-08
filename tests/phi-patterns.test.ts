/**
 * Tests for shared/phi-patterns.ts — the HIPAA-critical PHI redaction module
 * mirrored on the client side. Pattern-by-pattern coverage so any drift
 * vs server/services/phi-redactor.ts shows up loudly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactPhiText,
  deepScrubPhi,
  SSN_PATTERN,
  PHONE_PATTERN,
  EMAIL_PATTERN,
  DOB_PATTERN,
  DOB_NATURAL_PATTERN,
  DATE_PATTERN,
  MRN_PATTERN,
  MBI_PATTERN,
  MEDICAID_PATTERN,
  ADDRESS_PATTERN,
  ZIP_PATTERN,
  PLAN_ACCOUNT_PATTERN,
  NAME_PREFIX_PATTERN,
  TITLE_NAME_PATTERN,
} from "../shared/phi-patterns.js";

describe("shared/phi-patterns redactPhiText — pattern coverage", () => {
  it("returns the input unchanged for empty / null-ish input", () => {
    assert.equal(redactPhiText(""), "");
  });

  it("redacts SSN in canonical 123-45-6789 form", () => {
    // Note: "Patient ..." would also trigger NAME_PREFIX_PATTERN — using a
    // neutral context here so the SSN-only assertion is unambiguous.
    const result = redactPhiText("His ID is 123-45-6789.");
    assert.equal(result, "His ID is [REDACTED-SSN].");
  });

  it("redacts SSN in space-separated form", () => {
    const result = redactPhiText("ssn 123 45 6789");
    assert.ok(result.includes("[REDACTED-SSN]"), `expected SSN redaction in: ${result}`);
  });

  it("redacts SSN in run-together form", () => {
    assert.ok(redactPhiText("123456789").includes("[REDACTED-SSN]"));
  });

  it("redacts US phone numbers in (NNN) NNN-NNNN form", () => {
    const result = redactPhiText("Call (555) 123-4567 to reach me.");
    assert.ok(result.includes("[REDACTED-PHONE]"), `expected PHONE redaction in: ${result}`);
    assert.ok(!result.includes("555"));
  });

  it("redacts US phone numbers in 555-123-4567 form", () => {
    const result = redactPhiText("Direct line 555-123-4567");
    assert.ok(result.includes("[REDACTED-PHONE]"));
  });

  it("redacts US phone numbers in 555.123.4567 form", () => {
    assert.ok(redactPhiText("555.123.4567").includes("[REDACTED-PHONE]"));
  });

  it("does NOT redact a 12+ digit run as a phone (lookahead guard)", () => {
    // 11 digits CAN match because the optional `\+?1[-.\s]?` country-code
    // prefix consumes the leading "1", leaving 10 digits for the body.
    // 12 digits cannot: after the 11-digit consume, the trailing `(?!\d)`
    // lookahead sees the 12th digit and fails the match.
    const result = redactPhiText("Order 123456789012");
    assert.ok(!result.includes("[REDACTED-PHONE]"), `should not flag 12-digit order id: ${result}`);
  });

  it("redacts email addresses", () => {
    const result = redactPhiText("Contact patient at john.doe@example.com");
    assert.ok(result.includes("[REDACTED-EMAIL]"));
    assert.ok(!result.includes("john.doe"));
  });

  it("redacts DOB with explicit keyword (DOB 01/15/1952)", () => {
    const result = redactPhiText("DOB 01/15/1952");
    assert.ok(result.includes("[REDACTED-DOB]"), `expected DOB redaction in: ${result}`);
  });

  it("redacts 'date of birth' phrasing", () => {
    const result = redactPhiText("date of birth: 03-04-1960");
    assert.ok(result.includes("[REDACTED-DOB]"));
  });

  it("redacts natural-language birth dates", () => {
    const result = redactPhiText("She was born in January 1952.");
    assert.ok(result.includes("[REDACTED-DOB]"), `expected DOB redaction in: ${result}`);
  });

  it("redacts standalone pre-2010 birthdate-style dates", () => {
    const result = redactPhiText("01/15/1952");
    assert.ok(result.includes("[REDACTED-DATE]") || result.includes("[REDACTED-DOB]"));
  });

  it("redacts MRN with keyword prefix", () => {
    const result = redactPhiText("MRN 1234567");
    assert.ok(result.includes("[REDACTED-MRN]"), `expected MRN redaction in: ${result}`);
  });

  it("redacts patient ID with keyword prefix", () => {
    const result = redactPhiText("patient id ABC1234");
    assert.ok(result.includes("[REDACTED-MRN]"));
  });

  it("redacts Medicare Beneficiary IDs (MBI)", () => {
    // MBI format: 1AN9-AA0-AA00 — first char digit 1-9, second alpha
    const result = redactPhiText("MBI 1AN9-AA0-AA00");
    assert.ok(result.includes("[REDACTED-MBI]"), `expected MBI redaction in: ${result}`);
  });

  it("redacts Medicaid IDs with keyword", () => {
    const result = redactPhiText("medicaid id 12345678");
    assert.ok(result.includes("[REDACTED-MEDICAID-ID]"));
  });

  it("redacts street addresses", () => {
    const result = redactPhiText("Lives at 1234 Main Street.");
    assert.ok(result.includes("[REDACTED-ADDRESS]"), `expected ADDRESS redaction in: ${result}`);
  });

  it("redacts ZIP codes with state context", () => {
    const result = redactPhiText("Located in CA 90210");
    assert.ok(result.includes("[REDACTED-ZIP]"), `expected ZIP redaction in: ${result}`);
  });

  it("redacts ZIP codes with explicit 'zip' label", () => {
    const result = redactPhiText("zip code: 90210");
    assert.ok(result.includes("[REDACTED-ZIP]"));
  });

  it("redacts plan / policy numbers with keyword", () => {
    const result = redactPhiText("policy number ABC12345");
    assert.ok(result.includes("[REDACTED-PLAN-ID]"));
  });

  it("redacts patient names with clinical prefix", () => {
    const result = redactPhiText("patient: John Smith");
    assert.ok(result.includes("[REDACTED-NAME]"), `expected NAME redaction in: ${result}`);
  });

  it("redacts member names with clinical prefix", () => {
    const result = redactPhiText("member Mary Jane");
    assert.ok(result.includes("[REDACTED-NAME]"));
  });

  it("redacts titled names (Mr./Mrs./Dr.)", () => {
    const result = redactPhiText("Spoke with Dr. Sarah Connor");
    assert.ok(result.includes("[REDACTED-NAME]"), `expected NAME redaction in: ${result}`);
  });

  it("leaves benign text unchanged", () => {
    const input = "The system processed 42 calls today with average score 8.4.";
    assert.equal(redactPhiText(input), input);
  });

  it("redacts multiple distinct PHI items in one string", () => {
    const result = redactPhiText("Patient: John Smith, SSN 123-45-6789, phone (555) 123-4567");
    assert.ok(result.includes("[REDACTED-NAME]"));
    assert.ok(result.includes("[REDACTED-SSN]"));
    assert.ok(result.includes("[REDACTED-PHONE]"));
  });
});

describe("shared/phi-patterns deepScrubPhi", () => {
  it("returns null/undefined unchanged", () => {
    assert.equal(deepScrubPhi(null), null);
    assert.equal(deepScrubPhi(undefined), undefined);
  });

  it("returns primitives unchanged", () => {
    assert.equal(deepScrubPhi(42), 42);
    assert.equal(deepScrubPhi(true), true);
    assert.equal(deepScrubPhi(false), false);
  });

  it("scrubs PHI from a top-level string", () => {
    assert.equal(deepScrubPhi("ssn 123-45-6789"), "ssn [REDACTED-SSN]");
  });

  it("scrubs PHI from string values inside a flat object", () => {
    const input = { note: "Patient SSN is 123-45-6789", count: 5 };
    const result = deepScrubPhi(input) as { note: string; count: number };
    assert.ok(result.note.includes("[REDACTED-SSN]"));
    assert.equal(result.count, 5);
  });

  it("scrubs PHI from nested objects", () => {
    const input = {
      level1: {
        level2: {
          email: "Send to user@example.com please",
        },
      },
    };
    const result = deepScrubPhi(input) as typeof input;
    assert.ok(result.level1.level2.email.includes("[REDACTED-EMAIL]"));
  });

  it("scrubs PHI from arrays", () => {
    const input = ["call (555) 123-4567", "no PHI here", { ssn: "123-45-6789" }];
    const result = deepScrubPhi(input) as Array<string | { ssn: string }>;
    assert.ok((result[0] as string).includes("[REDACTED-PHONE]"));
    assert.equal(result[1], "no PHI here");
    assert.ok(((result[2] as { ssn: string }).ssn).includes("[REDACTED-SSN]"));
  });

  it("respects MAX_DEPTH=6 — deeply nested objects pass through unchanged below the cap", () => {
    // Build an 8-deep nested object with PHI at the deepest level.
    // Levels 0..6 should be walked; level 7 should be returned as-is.
    const deep: any = { ssn: "123-45-6789" };
    let nested: any = deep;
    for (let i = 0; i < 7; i++) {
      nested = { child: nested };
    }
    const result = deepScrubPhi(nested);
    // Walk back down to find the SSN string
    let cur: any = result;
    for (let i = 0; i < 7; i++) cur = cur.child;
    // At depth 7 the SSN should NOT have been scrubbed (depth bound exceeded)
    assert.equal(cur.ssn, "123-45-6789");
  });

  it("does not stack-overflow on circular references", () => {
    const a: any = { ssn: "123-45-6789" };
    const b: any = { back: a };
    a.cycle = b;
    // This must not throw a RangeError
    const result = deepScrubPhi(a) as any;
    assert.ok(result.ssn.includes("[REDACTED-SSN]"));
    // The cycle should still be traversable on the result side (the WeakSet
    // bails on the second visit, returning the value as-is on first encounter)
  });

  it("truncates strings longer than MAX_STRING_LENGTH (10000) before scrubbing", () => {
    const longString = "a".repeat(15000) + " 123-45-6789";
    const result = deepScrubPhi(longString) as string;
    // The trailing SSN is past the 10k cap, so it survives unredacted —
    // but the returned string is truncated to 10k chars max.
    assert.ok(result.length <= 10_000);
  });

  it("scrubs PHI inside truncated strings when the PHI sits before the cap", () => {
    const input = "ssn 123-45-6789 " + "x".repeat(15000);
    const result = deepScrubPhi(input) as string;
    assert.ok(result.includes("[REDACTED-SSN]"));
  });

  it("returns a new object — does not mutate the input", () => {
    const input = { note: "ssn 123-45-6789" };
    const original = input.note;
    deepScrubPhi(input);
    assert.equal(input.note, original);
  });
});
