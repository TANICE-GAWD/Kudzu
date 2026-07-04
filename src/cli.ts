

import "dotenv/config";
import { save, explorerUrl, type Skill } from "./core.js";
import { integrate } from "./integrate.js";

async function main() {
  const args = process.argv.slice(2);
  const pay = args.includes("--pay");
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: kudzu <openapi-spec-or-docs-url> [--pay]");
    process.exit(1);
  }

  const payOpts =
    pay && process.env.KUDZU_PRIVATE_KEY
      ? { privateKey: process.env.KUDZU_PRIVATE_KEY, network: process.env.KUDZU_NETWORK ?? "base-sepolia" }
      : undefined;
  if (pay && !payOpts) process.stderr.write("--pay set but KUDZU_PRIVATE_KEY missing; grading without payment.\n");

  process.stderr.write(`integrating ${url} …\n`);
  const skill = await integrate(url, payOpts);
  const file = save(skill);
  printCard(skill);
  process.stderr.write(`\ncatalog: ${file}\n`);
  process.exit(skill.grade!.status === "verified" ? 0 : 2);
}

function printCard(s: Skill) {
  const g = s.grade!;
  const badge = g.status === "verified" ? " VERIFIED" : " QUARANTINED";
  const cost = g.paid ? (g.estCostUsd != null ? `$${g.estCostUsd.toFixed(6)} (x402, real)` : "paid via x402 (real on-chain)") : "free / unknown";
  const explorer = explorerUrl(g);
  console.log(`
┌─ GRADE CARD ────────────────────────────────
│ skill     ${s.name}
│ endpoint  ${s.method} ${s.baseUrl}${s.path}
│ status    ${badge}
│ reason    ${g.reason}
│ latency   ${g.latencyMs ?? "—"} ms   http ${g.httpStatus ?? "—"}
│ parseable ${g.parseable}
│ cost/call ${cost}${g.paid ? `\n│ settled   ${g.network} tx ${g.txHash}` : ""}${explorer ? `\n│ verify    ${explorer}` : ""}
│ auth      ${s.authRequired ? "required (BYO key)" : "none"}
└─────────────────────────────────────────────`);
}

main().catch((e) => {
  console.error("kudzu failed:", e.message);
  process.exit(1);
});
