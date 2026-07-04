
import { z } from "zod";
import type { Skill } from "./core.js";

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

const Extracted = z.object({
  name: z.string(), 
  baseUrl: z.string(), 
  path: z.string(), 
  params: z.array(
    z.object({
      name: z.string(),
      in: z.enum(["path", "query", "header"]),
      required: z.boolean(),
      sample: z.string(), 
    }),
  ),
  authRequired: z.boolean(),
  outputIsJson: z.boolean(),
});

const SHAPE = `{"name":string,"baseUrl":string(absolute url),"path":string,"params":[{"name":string,"in":"path"|"query"|"header","required":boolean,"sample":string}],"authRequired":boolean,"outputIsJson":boolean}`;


export async function ingestDocs(url: string, hint?: string): Promise<Skill> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY not set (needed for docs-only LLM extraction)");
  const model = process.env.ANTHROPIC_MODEL ?? "anthropic/claude-haiku-4.5";

  let r: Response;
  try {
    r = await fetch(url);
  } catch (e: any) {
    throw new Error(`could not reach docs page: ${e.message}`);
  }
  if (!r.ok) throw new Error(`docs page returned HTTP ${r.status} — nothing to read`);
  const html = await r.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 40_000); 
  if (text.trim().length < 200) throw new Error("docs page has no readable text (JS-rendered or empty)");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            `Extract ONE simple no-body GET endpoint from API docs. Prefer no auth and few/no required params. ` +
            `Only use paths, hostnames, and version numbers that appear literally in the docs — never invent or guess a version. ` +
            `baseUrl must be absolute; fill sample values so the call actually works. Reply with ONLY a JSON object matching: ${SHAPE}`,
        },
        {
          role: "user",
          content:
            `SOURCE: ${url}\n\nDOCS:\n${text}` +
            (hint ? `\n\nIMPORTANT: a previous attempt failed — ${hint}. Pick a different endpoint or correct the version/params.` : ""),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json: any = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("gateway returned no content");
  
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in reply: ${content.slice(0, 200)}`);
  const e = Extracted.parse(JSON.parse(match[0]));
  
  const name = e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";
  return { ...e, name, source: url, method: "GET" };
}
