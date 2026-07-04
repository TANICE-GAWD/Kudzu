

import "dotenv/config";
import { readFileSync } from "node:fs";
import { save, type Skill } from "./core.js";
import { integrate } from "./integrate.js";

function urls(): string[] {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length) return args;
  return readFileSync(new URL("../fixtures/seed.txt", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const rows: { url: string; skill?: Skill; error?: string }[] = [];
for (const url of urls()) {
  process.stderr.write(`\n→ ${url}\n`);
  try {
    const skill = await integrate(url);
    save(skill);
    rows.push({ url, skill });
    const g = skill.grade!;
    process.stderr.write(`  ${g.status === "verified" ? "✅" : "⛔"} ${skill.name} — ${g.reason}\n`);
  } catch (e: any) {
    rows.push({ url, error: e.message });
    process.stderr.write(`  ⛔ unreachable — ${e.message}\n`);
  }
}

const verified = rows.filter((r) => r.skill?.grade?.status === "verified");
console.log(`\n┌─ KUDZU SELF-POPULATION REPORT ${"─".repeat(20)}`);
for (const r of rows) {
  const g = r.skill?.grade;
  const badge = g?.status === "verified" ? "✅" : "⛔";
  const name = r.skill?.name ?? "(no endpoint)";
  const detail = g ? `${g.latencyMs ?? "—"}ms` : "unreachable";
  console.log(`│ ${badge} ${name.padEnd(28)} ${detail.padStart(10)}  ${r.url}`);
}
console.log(`└${"─".repeat(51)}`);
console.log(`\n${verified.length} of ${rows.length} services integrated, verified, and priced — no code written, no one onboarded.`);
