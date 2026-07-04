
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ingest, grade, type Skill } from "./core.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "fixtures", "frankfurter.json");


const skill = await ingest(fixture);
assert.equal(skill.method, "GET");
assert.equal(skill.path, "/v1/latest");
assert.ok(skill.baseUrl.startsWith("https://"), "baseUrl must be absolute");
assert.ok(skill.name.length > 0, "skill needs a name");
assert.ok(JSON.parse(JSON.stringify(skill)), "skill must serialize to JSON");
console.log("✓ ingest emitted a valid skill:", skill.name);


const card = await grade(skill);
assert.equal(card.status, "verified", `expected verified, got ${card.status}: ${card.reason}`);
assert.equal(card.parseable, true, "graded call must return parseable JSON");
assert.ok(typeof card.sample === "object" && card.sample, "sample should be a JSON object");
assert.ok(card.latencyMs != null && card.latencyMs >= 0, "latency must be measured");
console.log(`✓ grade verified a real call: ${card.latencyMs}ms, parseable=${card.parseable}`);


const broken: Skill = { ...skill, baseUrl: "https://kudzu.invalid.example" };
const brokenCard = await grade(broken);
assert.equal(brokenCard.status, "quarantined", "unreachable endpoint must be quarantined");
console.log(`✓ broken endpoint quarantined: ${brokenCard.reason}`);

console.log("\nALL CHECKS PASSED");
