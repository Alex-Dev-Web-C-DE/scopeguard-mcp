#!/usr/bin/env node
// scopeguard-mcp - MCP server for ScopeGuard

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.SCOPEGUARD_API || "https://scopeguard-worker.boring-saas-infra.workers.dev";

const server = new McpServer({
  name: "scopeguard",
  version: "1.0.0",
});

async function apiFetch(path, options = {}) {
  const url = API_BASE + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

function fmt(data) {
  return JSON.stringify(data, null, 2);
}

server.tool(
  "register_scope",
  "Register a sanctions monitoring scope. You will get a webhook when matches change.",
  {
    query: z.string().min(2).describe("Entity name, country, or industry to monitor (e.g. Rosneft)"),
    webhook_url: z.string().url().describe("HTTP(S) URL where we POST JSON on change"),
  },
  async ({ query, webhook_url }) => {
    try {
      const { ok, status, data } = await apiFetch("/scope", {
        method: "POST",
        body: JSON.stringify({ query, webhook_url }),
      });
      if (!ok) {
        return { content: [{ type: "text", text: "Error " + status + ": " + fmt(data) }], isError: true };
      }
      return {
        content: [{
          type: "text",
          text: "Scope registered\n\nID: " + data.scope.id + "\nQuery: " + data.scope.query + "\nWebhook: " + data.scope.webhook_url + "\nCreated: " + data.scope.created_at,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: "Fetch error: " + e.message }], isError: true };
    }
  }
);

server.tool(
  "list_scopes",
  "List all registered sanctions monitoring scopes.",
  {},
  async () => {
    try {
      const { ok, status, data } = await apiFetch("/scopes");
      if (!ok) {
        return { content: [{ type: "text", text: "Error " + status + ": " + fmt(data) }], isError: true };
      }
      if (!data.scopes || data.scopes.length === 0) {
        return { content: [{ type: "text", text: "No scopes registered yet." }] };
      }
      const lines = data.scopes.map(function(s) {
        return "- " + s.query + " (id: " + s.id + ")\n  last_check: " + (s.last_check || "never") + "\n  last_matches: " + (s.last_match_count != null ? s.last_match_count : "-") + "\n  status: " + (s.last_status || "-");
      });
      return {
        content: [{
          type: "text",
          text: data.count + " scope(s) registered:\n\n" + lines.join("\n\n"),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: "Fetch error: " + e.message }], isError: true };
    }
  }
);

server.tool(
  "check_sanctions",
  "Screen a name against OFAC SDN, UK OFSI, EU Consolidated, and UN Consolidated sanctions lists.",
  {
    query: z.string().min(2).describe("Name to screen (person, company, vessel, aircraft)"),
  },
  async ({ query }) => {
    try {
      const { ok, status, data } = await apiFetch("/check", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      if (!ok) {
        return { content: [{ type: "text", text: "Error " + status + ": " + fmt(data) }], isError: true };
      }
      const result = data.result || {};
      const matches = result.results || [];
      if (matches.length === 0) {
        return {
          content: [{
            type: "text",
            text: "CLEAR - no matches for " + query + " in OFAC/UK/EU/UN lists.",
          }],
        };
      }
      const summary = matches.map(function(m) {
        return "- " + m.name + " [" + m.list + "] - score " + m.score + "\n  country: " + (m.country || "-") + " | type: " + m.type + "\n  " + m.source_url;
      }).join("\n\n");
      return {
        content: [{
          type: "text",
          text: result.status + " - " + matches.length + " match(es) for " + query + ":\n\n" + summary,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: "Fetch error: " + e.message }], isError: true };
    }
  }
);

server.tool(
  "delete_scope",
  "Delete a scope by its ID.",
  {
    id: z.string().min(1).describe("Scope ID to delete (from list_scopes)"),
  },
  async ({ id }) => {
    try {
      const { ok, status, data } = await apiFetch("/scope/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      if (!ok) {
        return { content: [{ type: "text", text: "Error " + status + ": " + fmt(data) }], isError: true };
      }
      return {
        content: [{ type: "text", text: "Deleted scope " + id }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: "Fetch error: " + e.message }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[scopeguard-mcp] running on stdio");
}

main().catch(function(e) {
  console.error("[scopeguard-mcp] fatal:", e);
  process.exit(1);
});