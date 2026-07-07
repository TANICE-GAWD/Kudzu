# Kudzu

An autonomous crawler and integration engine that ingests, grades, and monetizes the API internet.
Give it a URL. It returns a live, callable, graded, payable MCP tool. No engineer onboards it.

## High-level pipeline

```mermaid
flowchart LR
  URL[API URL] --> ING{OpenAPI spec?}
  ING -->|yes| SPEC[ingest parse spec]
  ING -->|no| DOCS[ingestDocs LLM reads HTML]
  SPEC --> SKILL[Skill]
  DOCS --> SKILL
  SKILL --> GRADE[grade real HTTP call]
  GRADE --> PAY{402?}
  PAY -->|pay flag set| X402[sign and settle on-chain]
  PAY -->|free| CHECK
  X402 --> CHECK{callable and parses?}
  CHECK -->|yes| VERIFIED[verified]
  CHECK -->|no| QUAR[quarantined never served]
  VERIFIED --> CAT[(Catalog JSON files)]
  CAT --> MCP[MCP tools in Claude and Cursor]
```

Three phases: ingestion, verification and grading, exposure and monetization.

## Component map

```mermaid
graph TD
  subgraph Entrypoints
    CLI[cli.ts single URL]
    CRAWL[crawl.ts batch from seed.txt]
    MCPS[mcp.ts serve verified skills]
    SELL[seller.ts reference x402 API]
  end
  subgraph Core[core.ts and integrate.ts]
    INT[integrate]
    IN[ingest]
    DO[ingestDocs in docs.ts]
    GR[grade]
    STORE[save and load catalog]
  end
  CLI --> INT
  CRAWL --> INT
  INT --> IN
  INT --> DO
  INT --> GR
  GR --> STORE
  MCPS --> STORE
  SELL -.->|402 target for pay flag| GR
```

## Grade sequence

```mermaid
sequenceDiagram
  participant K as Kudzu
  participant API as Target API
  participant Chain as Base Sepolia
  K->>API: GET endpoint (sample params)
  alt payment required
    API-->>K: 402 + accepts
    K->>Chain: sign EIP-3009, settle USDC
    K->>API: retry with X-PAYMENT
    API-->>K: 200 + x-payment-response (tx hash)
  else free
    API-->>K: 200
  end
  K->>K: check parseable, record latency + cost
  K-->>K: verified or quarantined
```

## Run

```bash
npm install
npm run kudzu -- https://petstore3.swagger.io/api/v3/openapi.json   # spec URL
npm run kudzu -- https://www.thecocktaildb.com/api.php              # docs page (LLM fallback)
npm run crawl                                                       # batch from fixtures/seed.txt
npm run run-catalog                                                # call every verified skill in catalog/ live
npm run mcp                                                         # serve verified skills over MCP (stdio)
npm run demo                                                        # assert-based self-check
```

Real x402 payment (testnet, free):

```bash
export KUDZU_PRIVATE_KEY=0x...      # Base Sepolia key, USDC from faucet.circle.com
export KUDZU_NETWORK=base-sepolia   # both read from .env
npm run seller                      # terminal 1: an x402-gated API
npm run kudzu -- fixtures/paid.json --pay   # terminal 2: 402, sign, settle, 200 + basescan tx
```

Docs-only fallback uses the Vercel AI Gateway (OpenAI-compatible):

```
AI_GATEWAY_API_KEY=vck_...
ANTHROPIC_MODEL=anthropic/claude-haiku-4.5   # optional default; use sonnet for hardest docs
```

## Core concepts

| Concept | What it is |
|---|---|
| Skill | Normalized API endpoint: base URL, method, path, params, auth, output type |
| Grade Card | Result of a real probe: status, latency, HTTP code, parseable, cost, settled tx |
| Catalog | Folder of JSON files, one per Skill. The database is the filesystem |
| Integration | ingest (spec) or ingestDocs (LLM) plus grade, producing a verified Skill |

The MCP server serves only verified Skills. Quarantined ones are never exposed.

## Deliberately skipped

- No crawler swarm, DB, queue, dashboard, or auth vault. A folder of JSON is the catalog.
- GET-only, cheapest-endpoint heuristic. Score all ops when a spec's best endpoint is not a GET.
