import assert from "node:assert/strict";
import test from "node:test";
import { getTrustedProviderEmail } from "./trusted-provider-email.js";

test("Google and Firebase email values are trusted only with a verified provider claim", () => {
  assert.equal(getTrustedProviderEmail(" User@Example.com ", true), "user@example.com");
  assert.equal(getTrustedProviderEmail("user@example.com", false), null);
  assert.equal(getTrustedProviderEmail("user@example.com", "true"), null);
  assert.equal(getTrustedProviderEmail(undefined, true), null);
});
