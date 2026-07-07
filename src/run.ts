


import "dotenv/config";
import { load, grade, type PayOpts } from "./core.js";

const pay: PayOpts | undefined = process.env.KUDZU_PRIVATE_KEY
  ? { privateKey: process.env.KUDZU_PRIVATE_KEY, network: process.env.KUDZU_NETWORK ?? "base-sepolia" }
  : undefined;

const only = process.argv.slice(2).find((a) => !a.startsWith("--")); 
const withLocal = process.argv.includes("--local"); 
const skills = load()
  .filter((s) => s.grade?.status === "verified")
  .filter((s) => withLocal || !/localhost|127\.0\.0\.1/.test(s.baseUrl))
  .filter((s) => !only || s.name.includes(only));

if (!skills.length) {
  console.error("no verified skills in catalog. run `npm run crawl` first.");
  process.exit(1);
}

console.log(`\nRunning ${skills.length} callable skill(s) from the catalog, live:\n`);

let ok = 0;
for (const s of skills) {
  const card = await grade(s, { pay });
  const badge = card.status === "verified" ? "OK " : "XX ";
  const meta = card.paid ? `${card.latencyMs}ms paid` : `${card.latencyMs}ms`;
  const preview = card.status === "verified" ? oneLine(card.sample) : card.reason;
  console.log(`${badge} ${s.name.padEnd(32)} ${String(meta).padEnd(12)} ${preview}`);
  if (card.status === "verified") ok++;
}

console.log(`\n${ok} of ${skills.length} callable right now.\n`);


function oneLine(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.replace(/\s+/g, " ").slice(0, 90);
}
