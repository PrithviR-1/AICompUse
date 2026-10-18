#!/usr/bin/env node
// Regenerates config/models.generated.json from Mixroute's public catalogue.
//
//   node scripts/sync-models.mjs            (uses cached pages under .cache/mixroute-models)
//   node scripts/sync-models.mjs --refresh  (re-downloads every page)
//
// Sources (checked 2026-10-18):
// - https://mixroute.ai/models/ embeds a JSON array (application/json script) with each model's
//   ID, display name, vendor, input/output modalities, input price and context size, and links
//   every model card to its detail page.
// - https://mixroute.ai/models/<slug>/ has "Model specs" (context, max output, I/O modalities),
//   "API endpoints" (OpenAI-compatible, Anthropic Messages, Gemini…), "Pricing" (input,
//   completion, cache read, cache creation, or per call) and "Capabilities" ("Available: …").
// - https://mixroute.ai/pricing/ has no per-model data; the console's /api/pricing needs a login.
//
// Never guesses: any value not stated on those pages is written as null.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(ROOT, ".cache", "mixroute-models");
const OUT = join(ROOT, "config", "models.generated.json");
const CATALOG_URL = "https://mixroute.ai/models/";
const REFRESH = process.argv.includes("--refresh");
const CONCURRENCY = 4;

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const textOf = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

async function fetchText(url, cacheName) {
  const cached = join(CACHE, cacheName);
  if (!REFRESH && existsSync(cached)) return readFileSync(cached, "utf8");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Machi model sync (+https://github.com/PrithviR-1/AICompUse)" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      writeFileSync(cached, body);
      return body;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

/** "400K" → 400000, "1M" → 1000000, "65.536K" → 65536, "–" → null. */
function tokens(value) {
  const m = /^([0-9.]+)\s*([KM])?$/i.exec(value ?? "");
  if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const modalityList = (s) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x && x !== "–");

const ENDPOINT_TYPES = {
  "openai-compatible": "openai",
  "anthropic messages": "anthropic",
  gemini: "gemini",
  "openai responses": "openai-response",
  responses: "openai-response",
};

function parseDetail(html) {
  const text = textOf(html);
  const between = (a, b) => {
    const i = text.indexOf(a);
    if (i < 0) return "";
    const j = text.indexOf(b, i + a.length);
    return text.slice(i + a.length, j < 0 ? undefined : j);
  };
  const specs = between("Model specs", "02 API endpoints");
  const context = /Context length (\S+)/.exec(specs)?.[1];
  const maxOutput = /Max output (\S+)/.exec(specs)?.[1];
  const io = /I\/O modalities Input: (.*?)\. Output: (.*?)\./.exec(specs);
  const released = /Released (\d{4}-\d{2})/.exec(specs)?.[1] ?? null;

  // "02 API endpoints One MixRoute gateway, OpenAI-compatible <Label> : <path> POST <Label> : …"
  const endpointsText = (text.match(/02 API endpoints (.*?) 03 /)?.[1] ?? "").replace(/^One MixRoute gateway, OpenAI-compatible\s*/, "");
  const endpoints = [];
  const parts = endpointsText.split(/ : (\/\S+) (?:POST|GET)\s*/);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const label = parts[i].trim();
    const type = ENDPOINT_TYPES[label.toLowerCase()] ?? label.toLowerCase().replace(/\s+/g, "-");
    if (label && !endpoints.some((e) => e.type === type)) endpoints.push({ type, label, path: parts[i + 1] });
  }

  // Flat: "03 Pricing Flat rate, unit: /1M Tokens Input $1.25 /1M Tokens Completion $10 /1M Tokens Cache read $0.125 …"
  // Tiered: "03 Tiered pricing Unit: /1M Tokens Tier Input /1M Tokens Output /1M Tokens Cache read … standard Length ≤ 272K $10 $50 $1 $12.5 long_context …"
  const pricing = text.match(/03 (?:Tiered )?[Pp]ricing (.*?) 0[45] /)?.[1] ?? "";
  const tiered = /03 Tiered pricing/.test(text);
  const prices = { input: null, output: null, cacheRead: null, cacheWrite: null };
  if (tiered) {
    const header = pricing.split(/ \$/)[0];
    const columns = [...header.matchAll(/(Input|Output|Completion|Cache read|Cache write|Cache creation) \/1M Tokens/g)].map((m) => m[1]);
    const values = [...pricing.matchAll(/\$([0-9.]+)/g)].slice(0, columns.length).map((m) => Number(m[1]));
    columns.forEach((c, i) => {
      if (c === "Input") prices.input = values[i] ?? null;
      if (c === "Output" || c === "Completion") prices.output = values[i] ?? null;
      if (c === "Cache read") prices.cacheRead = values[i] ?? null;
      if (c === "Cache write" || c === "Cache creation") prices.cacheWrite = values[i] ?? null;
    });
  } else {
    const price = (label) => {
      const m = new RegExp(`${label} \\$([0-9.]+) /1M Tokens`).exec(pricing);
      return m ? Number(m[1]) : null;
    };
    prices.input = price("Input");
    prices.output = price("Completion") ?? price("Output");
    prices.cacheRead = price("Cache read");
    prices.cacheWrite = price("Cache creation") ?? price("Cache write");
  }
  const perCall = /Per call \$([0-9.]+) \/call/.exec(pricing);

  // Capability labels are a fixed set on these pages ("Available: Tool calling", …).
  const capsText = text.match(/07 Capabilities(.*?)08 Token cost estimator/)?.[1] ?? "";
  const LABELS = ["Tool calling", "Structured output", "Streaming", "Vision input", "Prompt caching", "OpenAI SDK", "Automatic failover"];
  const available = LABELS.filter((l) => capsText.includes(`Available: ${l}`));
  const unavailable = LABELS.filter((l) => /(?:Not available|Unavailable): /.test(capsText) && capsText.includes(`available: ${l}`));
  const summary = text.match(/05 Selection summary(.*?)07 Capabilities/)?.[1] ?? "";
  const reasoning = /reasoning\.eff/i.test(summary) ? true : null;

  return {
    context: tokens(context),
    maxOutput: tokens(maxOutput),
    inputModalities: io ? modalityList(io[1]) : null,
    outputModalities: io ? modalityList(io[2]) : null,
    released,
    endpoints,
    inputPrice: prices.input,
    outputPrice: prices.output,
    cachedInputPrice: prices.cacheRead,
    cacheWritePrice: prices.cacheWrite,
    perCallPrice: perCall ? Number(perCall[1]) : null,
    tiered,
    available,
    unavailable,
    reasoning,
  };
}

/** Model type, from output modalities plus explicit ID rules where the site's labels are generic. */
function kindOf(id, inputs, outputs) {
  const name = id.toLowerCase();
  const out = new Set(outputs ?? []);
  if (/embed/.test(name) || out.has("embeddings")) return "embedding";
  if (/rerank/.test(name) || out.has("rerank")) return "rerank";
  if (out.has("video")) return "video";
  if (out.has("image")) return "image";
  if (out.has("audio")) return "audio";
  if (/whisper|transcri/.test(name) || (out.has("text") && (inputs ?? []).length === 1 && inputs[0] === "audio")) return "transcription";
  if (out.size === 1 && out.has("text")) return "chat";
  return "other";
}

function capabilityFlags(available, unavailable, inputs, reasoning) {
  const flag = (label) => (available.includes(label) ? true : unavailable.includes(label) ? false : null);
  return {
    tools: flag("Tool calling"),
    structuredOutput: flag("Structured output"),
    streaming: flag("Streaming"),
    promptCaching: flag("Prompt caching"),
    reasoning,
    vision: (inputs ?? []).includes("image") ? true : flag("Vision input"),
    fileInput: (inputs ?? []).includes("file") ? true : null,
  };
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const html = await fetchText(CATALOG_URL, "catalog.html");
  if (!html) throw new Error("catalogue page not found");

  const jsonBlock = /<script[^>]*application\/json[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!jsonBlock) throw new Error("embedded model JSON not found; the page layout changed");
  const entries = JSON.parse(jsonBlock[1]);

  // Card links map catalogue IDs to detail-page slugs.
  const slugById = new Map();
  for (const m of html.matchAll(/href="https:\/\/mixroute\.ai\/models\/([^/"]+)\/"[^>]*?data-model-id="(\d+)"/g)) {
    slugById.set(Number(m[2]), m[1]);
  }

  let done = 0;
  const models = await pool(entries, async (e) => {
    const slug = slugById.get(e.id) ?? e.model_name.toLowerCase().replace(/[.]/g, "-");
    const page = await fetchText(`https://mixroute.ai/models/${slug}/`, `${slug}.html`);
    const d = page ? parseDetail(page) : null;
    done++;
    if (done % 25 === 0) process.stderr.write(`  ${done}/${entries.length} detail pages\n`);
    const inputs = d?.inputModalities ?? e.modalities ?? null;
    const outputs = d?.outputModalities ?? e.output_modalities ?? null;
    const perCall = e.quota_type === 1 || d?.perCallPrice != null;
    return {
      id: e.model_name,
      name: e.display_name || e.model_name,
      vendor: e.vendor?.name ?? null,
      kind: kindOf(e.model_name, inputs, outputs),
      inputModalities: inputs,
      outputModalities: outputs,
      contextWindow: d?.context ?? (e.context_k ? Math.round(e.context_k * 1000) : null),
      maxOutput: d?.maxOutput ?? null,
      pricing: perCall ? "per-call" : "per-token",
      inputPrice: perCall ? null : (d?.inputPrice ?? e.input_price ?? null),
      outputPrice: perCall ? null : (d?.outputPrice ?? null),
      cachedInputPrice: perCall ? null : (d?.cachedInputPrice ?? null),
      cacheWritePrice: perCall ? null : (d?.cacheWritePrice ?? null),
      perCallPrice: d?.perCallPrice ?? null,
      tieredPricing: d?.tiered ?? false,
      capabilities: capabilityFlags(d?.available ?? [], d?.unavailable ?? [], inputs, d?.reasoning ?? null),
      endpoints: d?.endpoints.map((x) => x.type) ?? [],
      released: d?.released ?? null,
      detailPage: page ? `https://mixroute.ai/models/${slug}/` : null,
    };
  });

  models.sort((a, b) => a.id.localeCompare(b.id));
  const output = {
    note: "Generated by scripts/sync-models.mjs from Mixroute's public catalogue. Do not edit; override in config/models.toml.",
    source: CATALOG_URL,
    generatedAt: new Date().toISOString().slice(0, 10),
    count: models.length,
    models,
  };
  writeFileSync(OUT, JSON.stringify(output, null, 1) + "\n");
  const priced = models.filter((m) => m.outputPrice != null).length;
  console.log(`wrote ${models.length} models to config/models.generated.json (${priced} with output prices)`);
}

main().catch((err) => {
  console.error(`sync-models failed: ${err.message}`);
  process.exit(1);
});
