import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { OLLAMA_URL, OLLAMA_MODEL } from "../config/ollamaConfig.js";
import { rxFind, norm } from "../utils/textUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

// -------------------- CONFIG --------------------
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || OLLAMA_URL.replace(/\/api$/, "")).replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
const CHUNK_MAX_CHARS = parseInt(process.env.CHUNK_MAX_CHARS || "20000", 10); // Increased for fewer chunks
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "1000", 10);
const MAX_CONCURRENT_CHUNKS = parseInt(process.env.MAX_CONCURRENT_CHUNKS || "5", 10); // Process 5 chunks in parallel
const SKIP_TARGETED_FILL = process.env.SKIP_TARGETED_FILL === "true"; // Skip targeted fill for speed
const SKIP_FINAL_NORMALIZE = process.env.SKIP_FINAL_NORMALIZE === "true"; // Skip final normalize for speed

const NOT_SPECIFIED = "Not specified";

// -------------------- CORE SCHEMA (STRICT) --------------------
const CORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "metadata",
    "tender_summary",
    "administration",
    "evaluation",
    "requirements",
    "pricing",
    "contact_information",
  ],
  properties: {
    metadata: {
      type: "object",
      additionalProperties: false,
      required: [
        "tender_reference_number",
        "document_title",
        "document_type",
        "issue_date",
        "issuer",
        "country",
      ],
      properties: {
        tender_reference_number: { type: "string" },
        document_title: { type: "string" },
        document_type: { type: "string" },
        issue_date: { type: "string" },
        issuer: { type: "string" },
        country: { type: "string" },
      },
    },
    tender_summary: {
      type: "object",
      additionalProperties: false,
      required: ["project_title", "objective", "scope_summary"],
      properties: {
        project_title: { type: "string" },
        objective: { type: "string" },
        scope_summary: { type: "string" },
      },
    },
    administration: {
      type: "object",
      additionalProperties: false,
      required: ["submission_deadline", "proposal_validity_days", "submission_instructions"],
      properties: {
        submission_deadline: { type: "string" },
        proposal_validity_days: { anyOf: [{ type: "integer" }, { type: "null" }] },
        submission_instructions: { type: "string" },
      },
    },
    evaluation: {
      type: "object",
      additionalProperties: false,
      required: ["technical_weight_percent", "financial_weight_percent", "evaluation_criteria"],
      properties: {
        technical_weight_percent: { anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
        financial_weight_percent: { anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
        evaluation_criteria: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "weight_percent"],
            properties: {
              name: { type: "string" },
              weight_percent: { anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
            },
          },
        },
      },
    },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: ["functional_requirements", "technical_requirements"],
      properties: {
        functional_requirements: { type: "array", items: { type: "string" } },
        technical_requirements: { type: "array", items: { type: "string" } },
      },
    },
    pricing: {
      type: "object",
      additionalProperties: false,
      required: ["currency", "pricing_structure"],
      properties: {
        currency: { type: "string" },
        pricing_structure: { type: "string" },
      },
    },
    contact_information: {
      type: "object",
      additionalProperties: false,
      required: ["contact_name", "contact_email", "contact_phone"],
      properties: {
        contact_name: { type: "string" },
        contact_email: { type: "string" },
        contact_phone: { type: "string" },
      },
    },
  },
};

// -------------------- AJV VALIDATOR --------------------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(CORE_SCHEMA);

// -------------------- UTILS --------------------
function cleanText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + CHUNK_MAX_CHARS, text.length);
    chunks.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function stripToJsonString(raw) {
  if (typeof raw !== "string") return JSON.stringify(raw);
  let s = raw.trim();
  s = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1) s = s.slice(first, last + 1);
  return s;
}

function safeJsonParse(raw) {
  if (!raw) {
    throw new Error("Empty response from Ollama API");
  }
  
  const s = stripToJsonString(raw);
  
  if (!s || s.trim().length === 0) {
    throw new Error("No JSON content found in response");
  }
  
  try {
    return JSON.parse(s);
  } catch (e) {
    console.error("JSON Parse Error - Raw response:", raw);
    console.error("JSON Parse Error - Stripped:", s);
    console.error("JSON Parse Error:", e.message);
    throw new Error(`Failed to parse JSON: ${e.message}. Response preview: ${s.substring(0, 200)}`);
  }
}

function blankObject() {
  return {
    metadata: {
      tender_reference_number: NOT_SPECIFIED,
      document_title: NOT_SPECIFIED,
      document_type: NOT_SPECIFIED,
      issue_date: NOT_SPECIFIED,
      issuer: NOT_SPECIFIED,
      country: NOT_SPECIFIED,
    },
    tender_summary: {
      project_title: NOT_SPECIFIED,
      objective: NOT_SPECIFIED,
      scope_summary: NOT_SPECIFIED,
    },
    administration: {
      submission_deadline: NOT_SPECIFIED,
      proposal_validity_days: null,
      submission_instructions: NOT_SPECIFIED,
    },
    evaluation: {
      technical_weight_percent: NOT_SPECIFIED,
      financial_weight_percent: NOT_SPECIFIED,
      evaluation_criteria: [],
    },
    requirements: {
      functional_requirements: [],
      technical_requirements: [],
    },
    pricing: {
      currency: NOT_SPECIFIED,
      pricing_structure: NOT_SPECIFIED,
    },
    contact_information: {
      contact_name: NOT_SPECIFIED,
      contact_email: NOT_SPECIFIED,
      contact_phone: NOT_SPECIFIED,
    },
  };
}

function isNotSpecified(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim().toLowerCase() === NOT_SPECIFIED.toLowerCase());
}

function mergeArraysUnique(a = [], b = []) {
  const s = new Set();
  for (const x of [...a, ...b]) {
    if (typeof x === "string") {
      const k = x.trim();
      if (k) s.add(k);
    }
  }
  return Array.from(s);
}

function mergeCriteria(a = [], b = []) {
  const map = new Map();
  const add = (arr) => {
    for (const c of arr || []) {
      if (!c || typeof c !== "object") continue;
      const name = (c.name || "").trim();
      if (!name) continue;
      const prev = map.get(name);
      if (!prev) {
        map.set(name, { name, weight_percent: c.weight_percent ?? NOT_SPECIFIED });
      } else {
        // fill missing weight if available
        if (isNotSpecified(prev.weight_percent) && !isNotSpecified(c.weight_percent)) {
          prev.weight_percent = c.weight_percent;
        }
        map.set(name, prev);
      }
    }
  };
  add(a);
  add(b);
  return Array.from(map.values());
}

function deepMerge(base, inc) {
  const out = JSON.parse(JSON.stringify(base));
  const pick = (a, b) => (isNotSpecified(a) && !isNotSpecified(b) ? b : a);

  for (const k of Object.keys(out.metadata)) out.metadata[k] = pick(out.metadata[k], inc?.metadata?.[k]);
  for (const k of Object.keys(out.tender_summary)) out.tender_summary[k] = pick(out.tender_summary[k], inc?.tender_summary?.[k]);

  out.administration.submission_deadline = pick(out.administration.submission_deadline, inc?.administration?.submission_deadline);
  out.administration.submission_instructions = pick(out.administration.submission_instructions, inc?.administration?.submission_instructions);

  // numeric: prefer first real number found
  if (out.administration.proposal_validity_days == null && typeof inc?.administration?.proposal_validity_days === "number") {
    out.administration.proposal_validity_days = Math.trunc(inc.administration.proposal_validity_days);
  }

  out.evaluation.technical_weight_percent = pick(out.evaluation.technical_weight_percent, inc?.evaluation?.technical_weight_percent);
  out.evaluation.financial_weight_percent = pick(out.evaluation.financial_weight_percent, inc?.evaluation?.financial_weight_percent);
  out.evaluation.evaluation_criteria = mergeCriteria(out.evaluation.evaluation_criteria, inc?.evaluation?.evaluation_criteria);

  out.requirements.functional_requirements = mergeArraysUnique(out.requirements.functional_requirements, inc?.requirements?.functional_requirements);
  out.requirements.technical_requirements = mergeArraysUnique(out.requirements.technical_requirements, inc?.requirements?.technical_requirements);

  out.pricing.currency = pick(out.pricing.currency, inc?.pricing?.currency);
  out.pricing.pricing_structure = pick(out.pricing.pricing_structure, inc?.pricing?.pricing_structure);

  out.contact_information.contact_name = pick(out.contact_information.contact_name, inc?.contact_information?.contact_name);
  out.contact_information.contact_email = pick(out.contact_information.contact_email, inc?.contact_information?.contact_email);
  out.contact_information.contact_phone = pick(out.contact_information.contact_phone, inc?.contact_information?.contact_phone);

  return out;
}

function normalize(obj) {
  // Ensure all required keys + types are correct, fill missing
  if (!obj || typeof obj !== 'object') {
    console.warn('⚠️  normalize received invalid object, using blank object');
    return normalize(blankObject());
  }
  const o = obj;

  const ensureStr = (parent, key) => {
    if (parent[key] === undefined || parent[key] === null || (typeof parent[key] === "string" && !parent[key].trim())) {
      parent[key] = NOT_SPECIFIED;
    } else if (typeof parent[key] !== "string") {
      parent[key] = String(parent[key]);
    }
  };

  const ensureNumOrNull = (parent, key) => {
    const v = parent[key];
    if (v === undefined || v === null) parent[key] = null;
    else if (typeof v === "number" && Number.isFinite(v)) parent[key] = Math.trunc(v);
    else if (typeof v === "string") {
      const n = parseInt(v, 10);
      parent[key] = Number.isFinite(n) ? n : null;
    } else parent[key] = null;
  };

  // metadata
  for (const k of Object.keys(o.metadata)) ensureStr(o.metadata, k);

  // tender_summary
  for (const k of Object.keys(o.tender_summary)) ensureStr(o.tender_summary, k);

  // administration
  ensureStr(o.administration, "submission_deadline");
  ensureStr(o.administration, "submission_instructions");
  ensureNumOrNull(o.administration, "proposal_validity_days");

  // evaluation
  if (o.evaluation.technical_weight_percent === undefined || o.evaluation.technical_weight_percent === null) {
    o.evaluation.technical_weight_percent = NOT_SPECIFIED;
  }
  if (o.evaluation.financial_weight_percent === undefined || o.evaluation.financial_weight_percent === null) {
    o.evaluation.financial_weight_percent = NOT_SPECIFIED;
  }
  if (!Array.isArray(o.evaluation.evaluation_criteria)) o.evaluation.evaluation_criteria = [];
  o.evaluation.evaluation_criteria = o.evaluation.evaluation_criteria.map(c => ({
    name: (c?.name && String(c.name).trim()) ? String(c.name).trim() : NOT_SPECIFIED,
    weight_percent: (c?.weight_percent === undefined || c?.weight_percent === null || c?.weight_percent === "") ? NOT_SPECIFIED : c.weight_percent,
  }));

  // requirements
  if (!Array.isArray(o.requirements.functional_requirements)) o.requirements.functional_requirements = [];
  if (!Array.isArray(o.requirements.technical_requirements)) o.requirements.technical_requirements = [];
  o.requirements.functional_requirements = o.requirements.functional_requirements.map(x => String(x).trim()).filter(Boolean);
  o.requirements.technical_requirements = o.requirements.technical_requirements.map(x => String(x).trim()).filter(Boolean);

  // pricing
  ensureStr(o.pricing, "currency");
  ensureStr(o.pricing, "pricing_structure");

  // contact
  ensureStr(o.contact_information, "contact_name");
  ensureStr(o.contact_information, "contact_email");
  ensureStr(o.contact_information, "contact_phone");

  return o;
}

function validateOrThrow(obj) {
  const ok = validate(obj);
  if (!ok) {
    const details = validate.errors?.map(e => `${e.instancePath || "(root)"} ${e.message}`).join("; ");
    throw new Error(`Schema validation failed: ${details}`);
  }
}

function pruneToSchema(obj) {
  if (!obj || typeof obj !== 'object') return blankObject();
  
  // drop any extras and ensure only allowed properties
  const allowedTop = ["metadata","tender_summary","administration","evaluation","requirements","pricing","contact_information"];
  const out = {};
  
  for (const k of allowedTop) {
    if (obj[k] && typeof obj[k] === 'object') {
      out[k] = { ...obj[k] };
    } else {
      out[k] = obj[k];
    }
  }
  
  // Prune metadata - only allow specific keys
  if (out.metadata) {
    const allowedMetadata = ["tender_reference_number", "document_title", "document_type", "issue_date", "issuer", "country"];
    const pruned = {};
    for (const k of allowedMetadata) {
      pruned[k] = out.metadata[k];
    }
    out.metadata = pruned;
  }
  
  // Prune tender_summary
  if (out.tender_summary) {
    const allowedSummary = ["project_title", "objective", "scope_summary"];
    const pruned = {};
    for (const k of allowedSummary) {
      pruned[k] = out.tender_summary[k];
    }
    out.tender_summary = pruned;
  }
  
  // Prune administration
  if (out.administration) {
    const allowedAdmin = ["submission_deadline", "proposal_validity_days", "submission_instructions"];
    const pruned = {};
    for (const k of allowedAdmin) {
      pruned[k] = out.administration[k];
    }
    out.administration = pruned;
  }
  
  // Prune evaluation
  if (out.evaluation) {
    const allowedEval = ["technical_weight_percent", "financial_weight_percent", "evaluation_criteria"];
    const pruned = {};
    for (const k of allowedEval) {
      pruned[k] = out.evaluation[k];
    }
    // Ensure evaluation_criteria is an array
    if (Array.isArray(pruned.evaluation_criteria)) {
      pruned.evaluation_criteria = pruned.evaluation_criteria.map(c => {
        if (typeof c === 'object' && c !== null) {
          return { name: c.name || NOT_SPECIFIED, weight_percent: c.weight_percent ?? NOT_SPECIFIED };
        }
        return { name: NOT_SPECIFIED, weight_percent: NOT_SPECIFIED };
      });
    } else {
      pruned.evaluation_criteria = [];
    }
    out.evaluation = pruned;
  }
  
  // Prune requirements
  if (out.requirements) {
    const allowedReq = ["functional_requirements", "technical_requirements"];
    const pruned = {};
    for (const k of allowedReq) {
      pruned[k] = Array.isArray(out.requirements[k]) ? out.requirements[k] : [];
    }
    out.requirements = pruned;
  }
  
  // Prune pricing
  if (out.pricing) {
    const allowedPricing = ["currency", "pricing_structure"];
    const pruned = {};
    for (const k of allowedPricing) {
      pruned[k] = out.pricing[k];
    }
    out.pricing = pruned;
  }
  
  // Prune contact_information
  if (out.contact_information) {
    const allowedContact = ["contact_name", "contact_email", "contact_phone"];
    const pruned = {};
    for (const k of allowedContact) {
      pruned[k] = out.contact_information[k];
    }
    out.contact_information = pruned;
  }
  
  return out;
}

function buildIndex(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  return { lines };
}

function findSnippets(index, keywords, window = 4, limit = 30) {
  const { lines } = index;
  const hits = [];
  const ks = keywords.map(k => k.toLowerCase());

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].toLowerCase();
    if (ks.some(k => s.includes(k))) {
      const start = Math.max(0, i - window);
      const end = Math.min(lines.length, i + window + 1);
      hits.push(lines.slice(start, end).join("\n"));
      if (hits.length >= limit) break;
    }
  }
  return hits.join("\n\n---\n\n");
}

function getPath(obj, p) {
  const parts = p.split(".");
  let cur = obj;
  for (const x of parts) cur = cur?.[x];
  return cur;
}

function setPath(obj, p, value) {
  const parts = p.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

// -------------------- OLLAMA CLIENT --------------------
async function httpPost(url, body, timeout = 300000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const text = await res.text();
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}: ${text.substring(0, 500)}`);
    }
    
    try { 
      return JSON.parse(text); 
    } catch { 
      // If it's not JSON, return as text
      return text; 
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms for ${url}`);
    }
    throw e;
  }
}

async function ensureModel() {
  try {
    const url = `${OLLAMA_BASE_URL}/api/pull`;
    console.log(`📥 Pulling model ${MODEL} from ${url}...`);
    // According to Ollama API: { name: "model:tag" }
    const result = await httpPost(url, { name: MODEL });
    console.log(`✓ Model pull initiated/complete`);
    return result;
  } catch (e) {
    // Model might already be available, or pull might be in progress
    console.warn(`⚠️  Model pull warning (may already be available): ${e.message}`);
    // Don't throw - continue anyway as model might already be pulled
  }
}

async function chatJson(messages, retries = 2) {
  // Try /api/chat first; fallback /api/generate
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = await httpPost(`${OLLAMA_BASE_URL}/api/chat`, {
        model: MODEL,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0 }
      });

      let content = out?.message?.content ?? out?.response;
      
      // If content is an object, it might already be parsed
      if (typeof content === "object" && content !== null) {
        return content;
      }
      
      // If content is a string, try to parse it
      if (typeof content === "string") {
        if (!content.trim()) {
          throw new Error("Empty response from Ollama chat API");
        }
        return safeJsonParse(content);
      }
      
      // Fallback: try parsing the whole response
      if (typeof out === "object" && out !== null) {
        return out;
      }
      
      throw new Error("Unexpected response format from Ollama");
    } catch (e) {
      console.warn(`Chat API attempt ${attempt + 1} failed:`, e.message);
      
      // If this was the last attempt, try generate API
      if (attempt === retries) {
        try {
          const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
          const out = await httpPost(`${OLLAMA_BASE_URL}/api/generate`, {
            model: MODEL,
            prompt,
            stream: false,
            format: "json",
            options: { temperature: 0 }
          });
          
          let content = out?.response;
          
          // If content is an object, it might already be parsed
          if (typeof content === "object" && content !== null) {
            return content;
          }
          
          // If content is a string, try to parse it
          if (typeof content === "string") {
            if (!content.trim()) {
              throw new Error("Empty response from Ollama generate API");
            }
            return safeJsonParse(content);
          }
          
          // Fallback: try parsing the whole response
          if (typeof out === "object" && out !== null) {
            return out;
          }
          
          throw new Error("Unexpected response format from Ollama generate API");
        } catch (genError) {
          console.error("Generate API also failed:", genError.message);
          throw new Error(`Both chat and generate APIs failed. Last error: ${genError.message}`);
        }
      }
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

// -------------------- PROMPTS --------------------
const BASE_SCHEMA_TEXT = `{
  "metadata": {
    "tender_reference_number": "",
    "document_title": "",
    "document_type": "",
    "issue_date": "",
    "issuer": "",
    "country": ""
  },
  "tender_summary": {
    "project_title": "",
    "objective": "",
    "scope_summary": ""
  },
  "administration": {
    "submission_deadline": "",
    "proposal_validity_days": null,
    "submission_instructions": ""
  },
  "evaluation": {
    "technical_weight_percent": null,
    "financial_weight_percent": null,
    "evaluation_criteria": [
      { "name": "", "weight_percent": null }
    ]
  },
  "requirements": {
    "functional_requirements": [],
    "technical_requirements": []
  },
  "pricing": {
    "currency": "",
    "pricing_structure": ""
  },
  "contact_information": {
    "contact_name": "",
    "contact_email": "",
    "contact_phone": ""
  }
}`;

function systemMsg() {
  return {
    role: "system",
    content:
      "You are a strict information extraction engine. Return ONLY a single valid JSON object. No explanations. No extra keys.",
  };
}

function chunkPrompt({ chunk, tenderId, departmentName }) {
  return {
    role: "user",
    content: `
Extract tender data ONLY into the Core Tender Schema JSON below.
Return ONLY JSON. No extra keys.

Context:
- tender_id: ${tenderId || "Not provided"}
- department_name: ${departmentName || "Not provided"}

Schema (exact keys, exact nesting):
${BASE_SCHEMA_TEXT}

Rules:
- Use exact document facts. Map equivalent terms (e.g., bid validity -> proposal_validity_days).
- If missing: put "Not specified" for strings; null for numeric fields.
- Requirements: short bullet-like strings.
- Include all evaluation criteria found even if weight missing.
- Do not invent numbers, vendors, or prices.
- Do not extract bidder forms/appendices.

Chunk text:
"""${chunk}"""
`.trim(),
  };
}

function targetedFillPrompt({ fieldName, snippets, numeric }) {
  return {
    role: "user",
    content: `
Extract ONLY the value for this field: ${fieldName}

Rules:
- Use ONLY the provided snippets.
- If not present, output ${numeric ? "null" : `"${NOT_SPECIFIED}"`}.
- Return ONLY JSON: { "value": ... }

Snippets:
"""${snippets}"""
`.trim(),
  };
}

function finalNormalizePrompt({ mergedObject, fullText }) {
  return {
    role: "user",
    content: `
You must output ONLY the Core Tender Schema JSON, valid and clean, with no extra properties.

Given:
1) Merged candidate JSON:
${JSON.stringify(mergedObject)}

2) Full document text (for verification):
"""${fullText}"""

Tasks:
- Ensure every required field exists with correct type.
- Replace missing string fields with "Not specified".
- Replace missing numeric fields with null.
- Remove any extra keys.
- Ensure evaluation_criteria contains all criteria mentioned (even without weights).
- Ensure requirements are bullet-like brief strings.
- Ensure JSON is valid.

Return ONLY JSON.
`.trim(),
  };
}

// Fields to rescue if missing (keyword-targeted)
const FIELD_TARGETS = [
  ["metadata.tender_reference_number", ["reference", "ref", "tender", "RFP", "ID"], false],
  ["metadata.document_title", ["document title", "request for proposal", "RFP"], false],
  ["metadata.document_type", ["request for proposal", "rfp", "rfq", "itt", "tender"], false],
  ["metadata.issue_date", ["issue date", "date of issue", "issued on"], false],
  ["metadata.issuer", ["issuer", "authority", "department", "government"], false],
  ["metadata.country", ["country", "UAE", "United Arab Emirates"], false],

  ["administration.submission_deadline", ["submission deadline", "closing date", "last date", "deadline", "receipt of proposals"], false],
  ["administration.proposal_validity_days", ["validity", "proposal validity", "bid validity", "remain valid"], true],
  ["administration.submission_instructions", ["submit", "submission", "email", "address for communication"], false],

  ["pricing.currency", ["currency", "AED", "Dirhams", "USD", "SAR", "QAR", "OMR"], false],
  ["pricing.pricing_structure", ["fixed price", "lump sum", "inclusive", "price schedule", "commercial proposal"], false],

  ["contact_information.contact_name", ["contact", "attention", "address for communication"], false],
  ["contact_information.contact_email", ["email", "@", "mail"], false],
  ["contact_information.contact_phone", ["phone", "tel", "mobile"], false],

  ["evaluation.technical_weight_percent", ["technical weight", "technical evaluation", "weight"], true],
  ["evaluation.financial_weight_percent", ["financial weight", "commercial evaluation", "weight"], true],
];

// -------------------- TEXT EXTRACTION --------------------
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  let text = "";
  if (ext === ".pdf") {
    const data = await pdfParse(buf);
    text = data.text || "";
  } else if (ext === ".docx") {
    const res = await mammoth.extractRawText({ buffer: buf });
    text = res.value || "";
  } else if (ext === ".txt") {
    text = buf.toString("utf8");
  } else if (ext === ".html" || ext === ".htm") {
    const $ = cheerio.load(buf.toString("utf8"));
    text = $.text();
  } else {
    throw new Error(`Unsupported file type: ${ext}. Supported: pdf, docx, txt, html`);
  }

  return cleanText(text);
}

// -------------------- FAST KEYWORD-BASED EXTRACTION --------------------
function extractWithRegex(text, patterns) {
  for (const pattern of patterns) {
    const match = rxFind(text, pattern, "i");
    if (match) return norm(match);
  }
  return null;
}

function extractEmail(text) {
  const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const match = text.match(emailPattern);
  return match ? match[1] : null;
}

function extractPhone(text) {
  const phonePatterns = [
    /(?:\+971|971|0)?[\s\-]?[2-9][\s\-]?\d{3}[\s\-]?\d{4}/,
    /(?:\+971|971|0)?[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{4}/,
    /(?:\+971|971)?[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4}/,
  ];
  for (const pattern of phonePatterns) {
    const match = text.match(pattern);
    if (match) return norm(match[0]);
  }
  return null;
}

function extractDate(text, patterns) {
  for (const pattern of patterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      const cleaned = norm(match);
      // Try to extract a date-like string
      if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(cleaned) || /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(cleaned)) {
        return cleaned;
      }
    }
  }
  return null;
}

function extractNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      const num = parseInt(norm(match).replace(/[^\d]/g, ""), 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

function fastExtractMetadata(text, tenderId, departmentName) {
  const result = blankObject().metadata;
  
  // Tender Reference Number
  result.tender_reference_number = extractWithRegex(text, [
    String.raw`(?:tender|rfp|reference|ref)[\s\.]*[#:]?[\s]*([A-Z0-9\-/]+)`,
    String.raw`(?:RFP|Tender)[\s]*[#:]?[\s]*([A-Z0-9\-/]+)`,
    String.raw`Reference[\s]+(?:Number|No|ID)[\s]*[:]?[\s]*([A-Z0-9\-/]+)`,
  ]) || tenderId || NOT_SPECIFIED;
  
  // Document Title
  result.document_title = extractWithRegex(text, [
    String.raw`(?:Document\s+Title|Title)[\s]*[:]?[\s]*([^\n]{10,200})`,
    String.raw`(?:Request\s+for\s+Proposal|RFP)[\s]*[:]?[\s]*([^\n]{10,200})`,
    String.raw`^([A-Z][^\n]{20,150}(?:SAP|S4|S\/4|Implementation|RFP|Tender)[^\n]{0,100})`,
  ]) || NOT_SPECIFIED;
  
  // Document Type
  if (/request\s+for\s+proposal|rfp/i.test(text)) {
    result.document_type = "RFP";
  } else if (/request\s+for\s+quotation|rfq/i.test(text)) {
    result.document_type = "RFQ";
  } else if (/invitation\s+to\s+tender|itt/i.test(text)) {
    result.document_type = "ITT";
  } else {
    result.document_type = extractWithRegex(text, [
      String.raw`(?:Document\s+Type|Type)[\s]*[:]?[\s]*([A-Z]+)`,
    ]) || "RFP";
  }
  
  // Issue Date
  result.issue_date = extractDate(text, [
    String.raw`(?:Issue\s+Date|Date\s+of\s+Issue|Issued\s+on)[\s]*[:]?[\s]*([^\n]{5,50})`,
    String.raw`Date[:\s]+([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})`,
  ]) || NOT_SPECIFIED;
  
  // Issuer
  result.issuer = extractWithRegex(text, [
    String.raw`(?:Issued\s+by|Issuer|Authority|Department)[\s]*[:]?[\s]*([^\n]{5,200})`,
    String.raw`(?:Government\s+of|Ministry\s+of|Department\s+of)[\s]*([^\n]{5,200})`,
  ]) || departmentName || NOT_SPECIFIED;
  
  // Country
  if (/UAE|United\s+Arab\s+Emirates|Dubai|Abu\s+Dhabi|Sharjah/i.test(text)) {
    result.country = "UAE";
  } else if (/Saudi\s+Arabia|KSA|Riyadh/i.test(text)) {
    result.country = "Saudi Arabia";
  } else {
    result.country = extractWithRegex(text, [
      String.raw`Country[:\s]+([^\n]{2,50})`,
    ]) || "UAE";
  }
  
  return result;
}

function fastExtractAdministration(text) {
  const result = blankObject().administration;
  
  // Submission Deadline
  result.submission_deadline = extractDate(text, [
    String.raw`(?:Submission\s+Deadline|Closing\s+Date|Last\s+Date|Deadline)[\s]*[:]?[\s]*([^\n]{5,50})`,
    String.raw`(?:Proposals?\s+must\s+be|Submit)[\s]+(?:received|submitted)[\s]+(?:by|on|before)[\s]+([^\n]{5,50})`,
  ]) || NOT_SPECIFIED;
  
  // Proposal Validity Days
  result.proposal_validity_days = extractNumber(text, [
    String.raw`(?:Proposal|Bid)\s+validity[:\s]+(?:for\s+)?(\d+)\s*(?:days?|months?)`,
    String.raw`(?:remain|stay)\s+valid[:\s]+(?:for\s+)?(\d+)\s*(?:days?|months?)`,
    String.raw`validity[:\s]+(\d+)\s*(?:days?|months?)`,
  ]);
  
  // Submission Instructions
  result.submission_instructions = extractWithRegex(text, [
    String.raw`(?:Submission|Submit)[\s]+(?:Instructions|Requirements|Method)[\s]*[:]?[\s]*([^\n]{20,500})`,
    String.raw`(?:Proposals?\s+must\s+be|Please\s+submit)[\s]+([^\n]{20,500})`,
  ]) || NOT_SPECIFIED;
  
  return result;
}

function fastExtractContact(text) {
  const result = blankObject().contact_information;
  
  result.contact_email = extractEmail(text) || NOT_SPECIFIED;
  result.contact_phone = extractPhone(text) || NOT_SPECIFIED;
  
  result.contact_name = extractWithRegex(text, [
    String.raw`(?:Contact|Attention|Address\s+for\s+Communication)[\s]*[:]?[\s]*([^\n]{5,100})`,
    String.raw`(?:For\s+)?(?:queries|inquiries|contact)[\s]*[:]?[\s]*([^\n]{5,100})`,
  ]) || NOT_SPECIFIED;
  
  return result;
}

function fastExtractPricing(text) {
  const result = blankObject().pricing;
  
  // Currency
  if (/AED|Dirhams?|UAE\s+Dirham/i.test(text)) {
    result.currency = "UAE Dirhams";
  } else if (/USD|\$\s*|US\s+Dollar/i.test(text)) {
    result.currency = "USD";
  } else if (/SAR|Saudi\s+Riyal/i.test(text)) {
    result.currency = "SAR";
  } else {
    result.currency = extractWithRegex(text, [
      String.raw`Currency[:\s]+([A-Z]{3}|[^\n]{2,50})`,
    ]) || NOT_SPECIFIED;
  }
  
  // Pricing Structure
  if (/fixed\s+price|lump\s+sum/i.test(text)) {
    result.pricing_structure = "Fixed price";
  } else if (/time\s+and\s+materials|T&M/i.test(text)) {
    result.pricing_structure = "Time and materials";
  } else {
    result.pricing_structure = extractWithRegex(text, [
      String.raw`(?:Pricing|Price)\s+Structure[:\s]+([^\n]{5,200})`,
    ]) || NOT_SPECIFIED;
  }
  
  return result;
}

// -------------------- AI-BASED METADATA EXTRACTION --------------------
async function extractMetadataWithAI(text, tenderId, departmentName) {
  // Use first 3000 characters where metadata is typically found
  const metadataSection = text.substring(0, 3000);
  
  const prompt = {
    role: "user",
    content: `
Extract ONLY the metadata fields from the tender document header below.
Return ONLY valid JSON with these exact keys. Be precise and accurate.

Context:
- tender_id: ${tenderId || "Not provided"}
- department_name: ${departmentName || "Not provided"}

Extract these fields:
{
  "tender_reference_number": "extract reference number, RFP number, tender ID, or document reference",
  "document_title": "extract the full document title",
  "document_type": "RFP, RFQ, ITT, or Tender",
  "issue_date": "extract issue date, date of issue, or issued on date",
  "issuer": "extract issuer name, authority, department, or government entity",
  "country": "extract country name (e.g., UAE, Saudi Arabia)"
}

Rules:
- Extract EXACT values from the document - do not invent or guess
- For tender_reference_number: Look for "Reference", "RFP No", "Tender ID", "Document No", etc.
- For document_title: Look for "Title", "Request for Proposal", "RFP", or the main heading
- For document_type: Determine if it's RFP, RFQ, ITT, or Tender based on document content
- For issue_date: Look for "Issue Date", "Date of Issue", "Issued on", or similar
- For issuer: Look for "Issued by", "Authority", "Department", "Government of", etc.
- For country: Look for country name, or infer from issuer location (UAE, Saudi Arabia, etc.)
- If a field is truly not found, use "Not specified"
- Return ONLY JSON, no explanations

Document header (first 3000 characters):
"""${metadataSection}"""
`.trim(),
  };
  
  try {
    const result = await chatJson([systemMsg(), prompt]);
    if (result && (result.tender_reference_number || result.document_title || result.issuer)) {
      return result;
    }
  } catch (e) {
    console.warn(`⚠️  AI metadata extraction failed:`, e.message);
  }
  
  return null;
}

// -------------------- FAST KEYWORD-BASED EXTRACTION (MAIN) --------------------
export async function extractTender({ filePath, tenderId, departmentName }) {
  console.log(`\n⚡ FAST KEYWORD-BASED EXTRACTION MODE`);
  console.log(`   Using AI for metadata + regex patterns + targeted AI for complex fields`);
  
  const startTime = Date.now();
  const fullText = await extractText(filePath);
  console.log(`📄 Extracted ${fullText.length} characters from document`);
  
  // Step 1: AI-based metadata extraction (first 3000 chars)
  console.log(`🤖 Extracting metadata with AI (first 3000 chars)...`);
  let metadata = null;
  try {
    metadata = await extractMetadataWithAI(fullText, tenderId, departmentName);
    if (metadata) {
      console.log(`✓ AI metadata extraction complete`);
    } else {
      throw new Error("AI returned null");
    }
  } catch (e) {
    console.warn(`⚠️  AI metadata extraction failed, using regex fallback:`, e.message);
    metadata = fastExtractMetadata(fullText, tenderId, departmentName);
  }
  
  // Step 2: Fast regex-based extraction for other simple fields
  console.log(`🔍 Extracting other fields with regex patterns...`);
  const administration = fastExtractAdministration(fullText);
  const contact = fastExtractContact(fullText);
  const pricing = fastExtractPricing(fullText);
  
  console.log(`✓ Fast extraction complete (${Date.now() - startTime}ms)`);
  
  // Step 3: Extract evaluation section specifically
  console.log(`🔍 Searching for evaluation criteria section...`);
  let evaluationSection = "";
  const evalKeywords = ["evaluation criteria", "evaluation method", "scoring", "assessment", "selection criteria", "evaluation process", "proposal evaluation"];
  const lines = fullText.split('\n');
  let inEvalSection = false;
  let evalStartIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (evalKeywords.some(kw => line.includes(kw.toLowerCase()))) {
      inEvalSection = true;
      evalStartIdx = Math.max(0, i - 2);
    }
    if (inEvalSection && i - evalStartIdx < 100) {
      // Collect up to 100 lines after finding evaluation section
      evaluationSection += lines[i] + "\n";
    }
  }
  
  // If no specific section found, search middle section (where evaluation often is)
  if (!evaluationSection || evaluationSection.length < 200) {
    const midStart = Math.floor(fullText.length * 0.3);
    const midEnd = Math.floor(fullText.length * 0.7);
    evaluationSection = fullText.substring(midStart, midEnd);
  }
  
  // Step 4: Use AI for complex fields that need interpretation
  console.log(`🤖 Using AI for complex fields (summary, requirements, evaluation)...`);
  
  let aiResult = blankObject();
  try {
    // Get first 5000 chars (usually contains summary/intro) + last 5000 chars (usually contains requirements)
    const summarySection = fullText.substring(0, 5000);
    const requirementsSection = fullText.substring(Math.max(0, fullText.length - 5000));
    const combinedSection = summarySection + "\n\n---EVALUATION SECTION---\n\n" + evaluationSection.substring(0, 5000) + "\n\n---REQUIREMENTS SECTION---\n\n" + requirementsSection;
    
    const aiPrompt = {
      role: "user",
      content: `
Extract ONLY these complex fields from the tender document sections below.
Return ONLY valid JSON with these exact keys.

Context:
- tender_id: ${tenderId || "Not provided"}
- department_name: ${departmentName || "Not provided"}

Extract:
{
  "tender_summary": {
    "project_title": "extract project title",
    "objective": "extract objective/purpose",
    "scope_summary": "extract scope summary"
  },
  "evaluation": {
    "technical_weight_percent": extract number or "Not specified",
    "financial_weight_percent": extract number or "Not specified",
    "evaluation_criteria": [{"name": "criterion name", "weight_percent": number or "Not specified"}]
  },
  "requirements": {
    "functional_requirements": ["requirement 1", "requirement 2"],
    "technical_requirements": ["requirement 1", "requirement 2"]
  }
}

IMPORTANT - Evaluation Criteria Extraction:
- Look for sections titled: "Evaluation Criteria", "Evaluation Method", "Scoring", "Assessment", "Selection Criteria"
- Extract ALL evaluation criteria mentioned, even if weights are not specified
- Common criteria include: "Understanding of requirements", "Previous experience", "Cost competitiveness", "Quality of solution", "Technical approach", "Project management", "Team qualifications", "Implementation timeline", etc.
- For each criterion, extract the exact name as stated in the document
- If weight_percent is mentioned, extract it; otherwise use "Not specified"
- Include ALL criteria found, not just a few

Rules:
- Use exact document facts only
- Requirements: short bullet-like strings
- Evaluation criteria: Extract ALL criteria mentioned in evaluation/selection sections
- If missing: "Not specified" for strings, null for numbers
- Return ONLY JSON, no explanations

Document sections:
"""${combinedSection.substring(0, 12000)}"""
`.trim(),
    };
    
    aiResult = await chatJson([systemMsg(), aiPrompt]);
    
    // If evaluation_criteria is still empty, try dedicated extraction
    if (!aiResult.evaluation?.evaluation_criteria || aiResult.evaluation.evaluation_criteria.length === 0) {
      console.log(`🔍 Evaluation criteria not found, trying dedicated extraction...`);
      try {
        const evalPrompt = {
          role: "user",
          content: `
Extract ONLY evaluation criteria from the tender document section below.
Return ONLY valid JSON with this exact structure.

{
  "evaluation_criteria": [
    {"name": "exact criterion name from document", "weight_percent": number or "Not specified"},
    {"name": "exact criterion name from document", "weight_percent": number or "Not specified"}
  ]
}

IMPORTANT:
- Look for ALL evaluation criteria mentioned in the document
- Extract the EXACT names as written (e.g., "Vendor's understanding of requirements", "Previous experience", "Cost competitiveness", "Quality of proposed solution")
- Include ALL criteria, even if weights are missing
- If no criteria found, return empty array: []
- Return ONLY JSON, no explanations

Evaluation section:
"""${evaluationSection.substring(0, 6000)}"""
`.trim(),
        };
        
        const evalResult = await chatJson([systemMsg(), evalPrompt]);
        if (evalResult?.evaluation_criteria && evalResult.evaluation_criteria.length > 0) {
          if (!aiResult.evaluation) aiResult.evaluation = {};
          aiResult.evaluation.evaluation_criteria = evalResult.evaluation_criteria;
          console.log(`✓ Found ${evalResult.evaluation_criteria.length} evaluation criteria`);
        }
      } catch (e) {
        console.warn(`⚠️  Dedicated evaluation extraction failed:`, e.message);
      }
    }
    
    console.log(`✓ AI extraction complete`);
  } catch (e) {
    console.warn(`⚠️  AI extraction failed, using defaults:`, e.message);
    // Extract basic summary from first few lines as fallback
    const firstLines = fullText.split('\n').slice(0, 20).join(' ');
    if (firstLines.length > 50) {
      aiResult.tender_summary = {
        project_title: extractWithRegex(firstLines, [
          String.raw`(?:Project|Title)[\s]*[:]?[\s]*([^\n]{10,200})`,
          String.raw`^([A-Z][^\n]{20,150}(?:SAP|S4|Implementation|RFP)[^\n]{0,100})`,
        ]) || NOT_SPECIFIED,
        objective: extractWithRegex(firstLines, [
          String.raw`(?:Objective|Purpose|Goal)[\s]*[:]?[\s]*([^\n]{20,300})`,
        ]) || NOT_SPECIFIED,
        scope_summary: NOT_SPECIFIED,
      };
    }
  }
  
  // Step 4: Merge all results
  let merged = blankObject();
  
  // Ensure metadata is an object with all required fields
  if (metadata && typeof metadata === 'object') {
    merged.metadata = {
      tender_reference_number: metadata.tender_reference_number || NOT_SPECIFIED,
      document_title: metadata.document_title || NOT_SPECIFIED,
      document_type: metadata.document_type || "RFP",
      issue_date: metadata.issue_date || NOT_SPECIFIED,
      issuer: metadata.issuer || departmentName || NOT_SPECIFIED,
      country: metadata.country || "UAE",
    };
  } else {
    merged.metadata = fastExtractMetadata(fullText, tenderId, departmentName);
  }
  
  merged.administration = administration;
  merged.contact_information = contact;
  merged.pricing = pricing;
  
  // Merge AI results
  if (aiResult?.tender_summary) {
    merged.tender_summary = { ...merged.tender_summary, ...aiResult.tender_summary };
  }
  if (aiResult?.evaluation) {
    merged.evaluation = { ...merged.evaluation, ...aiResult.evaluation };
  }
  if (aiResult?.requirements) {
    merged.requirements = { ...merged.requirements, ...aiResult.requirements };
  }
  
  // Step 4: Normalize and validate
  merged = pruneToSchema(merged);
  merged = normalize(merged);
  validateOrThrow(merged);
  
  const totalTime = Date.now() - startTime;
  console.log(`✅ Extraction complete in ${(totalTime / 1000).toFixed(2)} seconds`);
  return merged;
}
