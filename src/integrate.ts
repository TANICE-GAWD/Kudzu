


import { ingest, grade, type Skill, type PayOpts } from "./core.js";

export async function integrate(url: string, pay?: PayOpts): Promise<Skill> {
  let skill: Skill;
  let usedDocs = false;
  try {
    skill = await ingest(url);
  } catch (e: any) {
    
    process.stderr.write(`  no spec (${e.message}); reading the docs …\n`);
    const { ingestDocs } = await import("./docs.js");
    skill = await ingestDocs(url);
    usedDocs = true;
  }

  let card = await grade(skill, { pay });
  skill.grade = card;

  
  
  if (usedDocs && card.status === "quarantined") {
    process.stderr.write("  first pick wasn't callable; re-reading with the failure as a hint …\n");
    const { ingestDocs } = await import("./docs.js");
    const hint = `${skill.method} ${skill.baseUrl}${skill.path} returned "${card.reason}"`;
    const retry = await ingestDocs(url, hint);
    const retryCard = await grade(retry, { pay });
    retry.grade = retryCard;
    if (retryCard.status === "verified") skill = retry;
  }
  return skill;
}
