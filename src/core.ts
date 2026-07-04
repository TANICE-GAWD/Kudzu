
import { dereference } from "@readme/openapi-parser";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wrapFetchWithPayment, createSigner, decodeXPaymentResponse } from "x402-fetch";

export const CATALOG_DIR = join(process.cwd(), "catalog");

export type Param = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  sample: unknown; 
};

export type Skill = {
  name: string;
  source: string; 
  baseUrl: string;
  method: string;
  path: string;
  params: Param[];
  authRequired: boolean;
  outputIsJson: boolean; 
  grade?: GradeCard;
};

export type GradeCard = {
  status: "verified" | "quarantined";
  reason: string;
  latencyMs: number | null;
  httpStatus: number | null;
  parseable: boolean;
  sample: unknown; 
  estCostUsd: number | null; 
  paid: boolean;
  txHash: string | null; 
  network: string | null;
  gradedAt: string;
};


const EXPLORERS: Record<string, string> = {
  "base-sepolia": "https://sepolia.basescan.org/tx/",
  base: "https://basescan.org/tx/",
};
export function explorerUrl(card: GradeCard): string | null {
  if (!card.txHash || !card.network) return null;
  const base = EXPLORERS[card.network];
  return base ? base + card.txHash : null;
}


export async function ingest(specUrlOrPath: string): Promise<Skill> {
  const api: any = await dereference(specUrlOrPath);
  const baseUrl = pickBaseUrl(api, specUrlOrPath);

  let best: { path: string; op: any; required: number } | null = null;
  for (const [path, item] of Object.entries<any>(api.paths ?? {})) {
    const op = item?.get;
    if (!op) continue; 
    const required = (op.parameters ?? []).filter((p: any) => p.required).length;
    if (!best || required < best.required) best = { path, op, required };
  }
  if (!best) throw new Error("No GET operation found in spec to integrate.");

  const params: Param[] = (best.op.parameters ?? [])
    .filter((p: any) => p.in === "path" || p.in === "query" || p.in === "header")
    .map((p: any) => ({
      name: p.name,
      in: p.in,
      required: !!p.required,
      sample: sampleFor(p),
    }));

  const security = best.op.security ?? api.security ?? [];
  const authRequired = Array.isArray(security) && security.length > 0;

  const ok = best.op.responses?.["200"] ?? best.op.responses?.["default"];
  const outputIsJson = !!ok?.content?.["application/json"];

  return {
    name: (api.info?.title ?? "api").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    source: specUrlOrPath,
    baseUrl,
    method: "GET",
    path: best.path,
    params,
    authRequired,
    outputIsJson,
  };
}

function pickBaseUrl(api: any, specUrlOrPath: string): string {
  const server = api.servers?.[0]?.url;
  if (server && /^https?:\/\//.test(server)) return server.replace(/\/$/, "");
  
  try {
    const u = new URL(specUrlOrPath);
    return server ? new URL(server, u).toString().replace(/\/$/, "") : u.origin;
  } catch {
    throw new Error(`Spec has no absolute server URL and source isn't a URL: ${specUrlOrPath}`);
  }
}


function sampleFor(p: any): unknown {
  const s = p.schema ?? {};
  if (p.example !== undefined) return p.example;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  switch (s.type) {
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    default:
      return "test";
  }
}


export type PayOpts = { privateKey: string; network: string };

export async function grade(skill: Skill, opts: { pay?: PayOpts } = {}): Promise<GradeCard> {
  let url: string;
  try {
    url = buildUrl(skill);
  } catch (e: any) {
    return quarantine(`could not build request URL: ${e.message}`);
  }

  const headers: Record<string, string> = {};
  for (const p of skill.params) if (p.in === "header") headers[p.name] = String(p.sample);
  applyByoKey(skill, url, headers);

  
  let doFetch: typeof fetch = fetch;
  let paid = false;
  let estCostUsd: number | null = null;
  if (opts.pay) {
    const signer = await createSigner(opts.pay.network, opts.pay.privateKey);
    doFetch = wrapFetchWithPayment(fetch, signer) as unknown as typeof fetch;
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(url, { headers });
  } catch (e: any) {
    return quarantine(`endpoint unreachable: ${e.message}`);
  }
  const latencyMs = Date.now() - started;

  
  let txHash: string | null = null;
  let network: string | null = null;
  const payHeader = res.headers.get("x-payment-response");
  if (payHeader) {
    paid = true;
    try {
      const decoded: any = decodeXPaymentResponse(payHeader);
      txHash = decoded?.transaction ?? null;
      network = decoded?.network ?? null;
      const raw = Number(decoded?.amount ?? decoded?.value);
      if (Number.isFinite(raw)) estCostUsd = raw / 1_000_000; 
    } catch {
      
    }
  }

  if (!res.ok) return { ...quarantine(`HTTP ${res.status}`), latencyMs, httpStatus: res.status, paid, estCostUsd, txHash, network };

  const text = await res.text();
  let parseable = false;
  let sample: unknown = text.slice(0, 400);
  if (skill.outputIsJson || looksJson(text)) {
    try {
      sample = trim(JSON.parse(text));
      parseable = true;
    } catch {
      
    }
  }

  if (skill.outputIsJson && !parseable) {
    return { ...quarantine("spec promised JSON but response did not parse"), latencyMs, httpStatus: res.status, sample, paid, estCostUsd, txHash, network };
  }

  return {
    status: "verified",
    reason: paid ? "callable; x402 payment settled" : "callable; returned a usable result",
    latencyMs,
    httpStatus: res.status,
    parseable,
    sample,
    estCostUsd,
    paid,
    txHash,
    network,
    gradedAt: new Date().toISOString(),
  };
}

function buildUrl(skill: Skill): string {
  let path = skill.path;
  const query = new URLSearchParams();
  for (const p of skill.params) {
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.sample)));
    else if (p.in === "query" && (p.required || p.sample !== undefined)) query.set(p.name, String(p.sample));
  }
  if (/\{[^}]+\}/.test(path)) throw new Error(`unfilled path params in ${path}`);
  const qs = query.toString();
  return skill.baseUrl + path + (qs ? `?${qs}` : "");
}


function applyByoKey(skill: Skill, url: string, headers: Record<string, string>) {
  const key = process.env.KUDZU_API_KEY;
  if (!key || !skill.authRequired) return;
  const headerName = process.env.KUDZU_API_KEY_HEADER ?? "Authorization";
  headers[headerName] = headerName === "Authorization" ? `Bearer ${key}` : key;
}

function quarantine(reason: string): GradeCard {
  return { status: "quarantined", reason, latencyMs: null, httpStatus: null, parseable: false, sample: null, estCostUsd: null, paid: false, txHash: null, network: null, gradedAt: new Date().toISOString() };
}

const looksJson = (t: string) => /^\s*[[{]/.test(t);

function trim(v: unknown): unknown {
  const s = JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…(trimmed)` : v;
}



export function save(skill: Skill): string {
  mkdirSync(CATALOG_DIR, { recursive: true });
  const file = join(CATALOG_DIR, `${skill.name}.json`);
  writeFileSync(file, JSON.stringify(skill, null, 2));
  return file;
}

export function load(): Skill[] {
  try {
    return readdirSync(CATALOG_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(CATALOG_DIR, f), "utf8")) as Skill);
  } catch {
    return [];
  }
}
