
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { load, type Skill } from "./core.js";

const server = new McpServer({ name: "kudzu", version: "0.0.1" });

const skills = load().filter((s) => s.grade?.status === "verified");
for (const s of skills) registerSkill(s);

function registerSkill(s: Skill) {
  server.registerTool(
    s.name,
    {
      description: `${s.method} ${s.path} — auto-integrated by Kudzu, graded ${s.grade?.gradedAt}. Params: ${s.params.map((p) => p.name).join(", ") || "none"}.`,

      inputSchema: { params: z.record(z.string(), z.any()).optional() },
    },
    async ({ params }: { params?: Record<string, unknown> }) => {
      const url = buildUrl(s, params ?? {});
      const res = await fetch(url);
      const body = await res.text();
      return { content: [{ type: "text", text: `HTTP ${res.status}\n${body.slice(0, 2000)}` }] };
    },
  );
}

function buildUrl(s: Skill, override: Record<string, unknown>): string {
  let path = s.path;
  const query = new URLSearchParams();
  for (const p of s.params) {
    const v = override[p.name] ?? p.sample;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === "query" && v !== undefined) query.set(p.name, String(v));
  }
  const qs = query.toString();
  return s.baseUrl + path + (qs ? `?${qs}` : "");
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`kudzu MCP up — serving ${skills.length} verified skill(s): ${skills.map((s) => s.name).join(", ") || "(none)"}\n`);
