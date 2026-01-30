import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as cheerio from "cheerio";
import { z } from "zod";
import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_ENABLED } from "../config/ollamaConfig.js";

/* ----------------------------- Configuration ----------------------------- */

// Construct base host from OLLAMA_URL (which may include /api)
const baseUrl = OLLAMA_URL || "http://ollama-sales.mobiusdtaas.ai/api";
const baseHost = baseUrl.replace(/\/api\/?$/, "") || "http://ollama-sales.mobiusdtaas.ai";
const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || baseHost;
const OLLAMA_PULL_URL = process.env.OLLAMA_PULL_URL || `${DEFAULT_OLLAMA_HOST.replace(/\/+$/, "")}/api/pull`;
const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || `${DEFAULT_OLLAMA_HOST.replace(/\/+$/, "")}/api/chat`;
const MODEL = OLLAMA_MODEL || "gpt-oss:120b";

const MAX_DOC_CHARS = Number(process.env.MAX_DOC_CHARS || 500_000);
const LLM_MAX_CHARS_PER_CALL = Number(process.env.LLM_MAX_CHARS_PER_CALL || 28_000);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 180_000);

/* ------------------------------- Utilities ------------------------------ */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJsonParse(str) {
  const trimmed = String(str || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (_) {}
    }
    return null;
  }
}

function normalizeWhitespace(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function detectFileType(filename) {
  const ext = (path.extname(filename || "") || "").toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx" || ext === ".doc") return "docx";
  if (ext === ".txt") return "text";
  if (ext === ".md") return "text";
  if (ext === ".html" || ext === ".htm") return "html";
  return "unknown";
}

function chunkText(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return [t];

  const chunks = [];
  let start = 0;

  while (start < t.length) {
    let end = Math.min(start + maxChars, t.length);
    const window = t.slice(start, end);
    const lastBreak = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (lastBreak > Math.floor(maxChars * 0.5)) {
      end = start + lastBreak;
    }
    chunks.push(t.slice(start, end));
    start = end;
  }

  return chunks.map(normalizeWhitespace).filter(Boolean);
}

/* ------------------------- Document Text Extraction ---------------------- */

async function extractTextFromBuffer(buffer, filename = "file") {
  const type = detectFileType(filename);
  if (type === "docx") {
    const res = await mammoth.extractRawText({ buffer });
    return normalizeWhitespace(res.value || "");
  }
  if (type === "pdf") {
    const data = await pdfParse(buffer);
    return normalizeWhitespace(data.text || "");
  }
  if (type === "html") {
    const html = buffer.toString("utf8");
    const $ = cheerio.load(html);
    const text = $("body").text();
    return normalizeWhitespace(text || "");
  }
  return normalizeWhitespace(buffer.toString("utf8") || "");
}

/* ------------------------------- Ollama --------------------------------- */

async function ensureModelPulled(model = MODEL) {
  if (!OLLAMA_ENABLED) return { ok: false, error: "Ollama disabled" };
  
  const payload = { name: model, stream: false };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    const resp = await fetch(OLLAMA_PULL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) return { ok: false, status: resp.status };
    const txt = await resp.text();
    return { ok: true, response: txt.slice(0, 5000) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function ollamaChat({ model = MODEL, messages, stream = false, options = {} }) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is disabled. Set OLLAMA_ENABLED=true to use this feature.");
  }

  const payload = { model, messages, stream, options };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const resp = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      throw new Error(`Ollama chat failed: HTTP ${resp.status} ${errTxt}`);
    }

    const data = await resp.json();
    const content = data?.message?.content ?? "";
    return { content, raw: data };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- Agent JSON Schema --------------------------- */

const OutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  sections: z.array(
    z.object({
      sectionTitle: z.string().min(1),
      rows: z.array(
        z.object({
          id: z.number().int().positive(),
          vendorQuestion: z.string().min(1),
          suggestedGovernmentAnswer: z.string().min(1),
          addendum: z.string().min(1),
        })
      ),
    })
  ),
});

/* ---------------------- Heuristic Query Extraction ----------------------- */

function extractSectionsHeuristically(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim());
  const sections = [];
  let currentSection = { sectionTitle: "All queries", rows: [] };

  const headingRe =
    /^(section\s+[a-z0-9]+[\s:—-]+)?(administrative|submission|technical|scope|integration|interface|data migration|testing|training|acceptance|commercial|payment|bond|bonds|staffing|language|governance|project management|infrastructure|architecture)\b/i;

  const queryStartRe =
    /^(query\s*#?\s*(\d+)[\s:—-]+|(\d+)[.)]\s+|[-*•]\s+)(.+)$/i;

  const pushSectionIfMeaningful = () => {
    if (currentSection.rows.length > 0) sections.push(currentSection);
  };

  let seq = 1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;

    if (headingRe.test(l) && l.length < 120 && !queryStartRe.test(l)) {
      pushSectionIfMeaningful();
      currentSection = {
        sectionTitle: l.replace(/^section\s+[a-z0-9]+[\s:—-]+/i, "").trim(),
        rows: [],
      };
      continue;
    }

    const m = l.match(queryStartRe);
    if (m) {
      const id = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : seq;
      let q = m[4] || "";
      let j = i + 1;
      while (j < lines.length) {
        const nl = lines[j];
        if (!nl) {
          j++;
          continue;
        }
        if (headingRe.test(nl) && nl.length < 120 && !queryStartRe.test(nl)) break;
        if (queryStartRe.test(nl)) break;
        if (/^page\s+\d+/i.test(nl)) break;

        q += " " + nl;
        j++;
      }
      i = j - 1;

      q = normalizeWhitespace(q);

      const looksQuestion =
        /[?]$/.test(q) ||
        /\b(what|when|who|where|how|kindly|please|confirm|clarify|share|provide|can you)\b/i.test(q);

      if (looksQuestion && q.length > 8) {
        currentSection.rows.push({
          id: Number.isFinite(id) ? id : seq,
          vendorQuestion: q,
        });
        seq = Math.max(seq, (Number.isFinite(id) ? id : seq) + 1);
      }
    }
  }

  pushSectionIfMeaningful();

  for (const s of sections) {
    s.rows.sort((a, b) => a.id - b.id);
  }

  return sections;
}

/* --------------------------- LLM-Assisted Extraction --------------------- */

async function extractSectionsWithLLM(fullText) {
  const chunks = chunkText(fullText, LLM_MAX_CHARS_PER_CALL);
  const extracted = [];

  console.log(`  📝 Extracting queries using LLM (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})...`);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    console.log(`  ⏳ Processing chunk ${idx + 1}/${chunks.length}...`);
    
    const sys = `You extract vendor pre-bid queries from tender documents.
Return ONLY valid JSON.
Rules:
- Extract each distinct vendor query as an object: { "id": <int or null>, "question": "<string>" }
- Do NOT answer queries.
- Do NOT invent.
- If id is not visible, use null.
- Keep the question concise but faithful.
Return JSON: { "items": [ ... ] }`;

    const user = `DOCUMENT CHUNK ${idx + 1}/${chunks.length}:\n\n${chunk}\n\nExtract the vendor queries.`;

    const { content } = await ollamaChat({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      stream: false,
      options: { temperature: 0 },
    });
    
    console.log(`  ✓ Chunk ${idx + 1}/${chunks.length} processed`);

    const parsed = safeJsonParse(content);
    const items = parsed?.items;
    if (Array.isArray(items)) {
      for (const it of items) {
        const q = normalizeWhitespace(it?.question || "");
        const id = Number.isFinite(it?.id) ? Number(it.id) : null;
        if (q && q.length > 8) extracted.push({ id, question: q });
      }
    }
  }

  const seen = new Set();
  const uniq = [];
  for (const it of extracted) {
    const key = it.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key.length < 12) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(it);
  }

  let maxId = 0;
  for (const it of uniq) if (it.id && it.id > maxId) maxId = it.id;
  let nextId = maxId + 1;

  const rows = uniq
    .map((it) => ({
      id: it.id ?? nextId++,
      vendorQuestion: it.question,
    }))
    .sort((a, b) => a.id - b.id);

  const sys2 = `You group tender pre-bid questions into logical sections.
Return ONLY valid JSON.
Input is a list of questions with ids.
Output JSON schema:
{ "sections": [ { "sectionTitle": "...", "ids": [1,2,3] } ] }
Rules:
- Use common tender headings: Administrative or submission, Technical or scope, Integration and interfaces, Data migration and testing, Testing, training and acceptance, Infrastructure and architecture, Project management and governance, Resource and language, Commercial and contractual.
- If unsure, use "All queries".
- Every id must appear exactly once.`;

  const user2 = JSON.stringify({ rows }, null, 2);

  console.log(`  ⏳ Grouping ${rows.length} queries into sections...`);
  const { content: groupingText } = await ollamaChat({
    messages: [
      { role: "system", content: sys2 },
      { role: "user", content: user2 },
    ],
    stream: false,
    options: { temperature: 0 },
  });
  console.log(`  ✓ Grouping complete`);

  const grouping = safeJsonParse(groupingText);
  const secDefs = Array.isArray(grouping?.sections) ? grouping.sections : [{ sectionTitle: "All queries", ids: rows.map((r) => r.id) }];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const sections = [];
  const used = new Set();

  for (const sd of secDefs) {
    const title = normalizeWhitespace(sd?.sectionTitle || "All queries") || "All queries";
    const ids = Array.isArray(sd?.ids) ? sd.ids : [];
    const srows = [];
    for (const id of ids) {
      const rid = Number(id);
      if (!Number.isFinite(rid)) continue;
      if (used.has(rid)) continue;
      const r = byId.get(rid);
      if (r) {
        srows.push({ id: r.id, vendorQuestion: r.vendorQuestion });
        used.add(rid);
      }
    }
    if (srows.length) sections.push({ sectionTitle: title, rows: srows });
  }

  const missing = rows.filter((r) => !used.has(r.id));
  if (missing.length) {
    sections.push({ sectionTitle: "All queries", rows: missing.map((r) => ({ id: r.id, vendorQuestion: r.vendorQuestion })) });
  }

  return sections;
}

/* --------------------------- Answer + Addendum --------------------------- */

function buildAgentSystemPrompt({ authorityName }) {
  return `You are TenderPreBidQueryAddendumAgent.
You help a tendering authority prepare structured answers to vendor pre-bid queries and decide which clarifications should be included in an official RFP addendum.

Critical rules:
- Use ONLY facts explicitly stated or clearly implied in the provided document text.
- NEVER invent dates, amounts, percentages, versions, URLs, email addresses, SLAs, clause numbers.
- If the document is silent/ambiguous, say: "Not specified in the provided document." Then propose recommended addendum wording (clearly labeled "Recommendation: ...").
- Answer from the authority perspective (${authorityName || "tendering authority"}), not vendor.
- Be concise, formal, and operational.

You must return ONLY valid JSON.
Output schema:
{
  "title": "...",
  "description": "...",
  "sections": [
    {
      "sectionTitle": "...",
      "rows": [
        { "id": 1, "vendorQuestion": "...", "suggestedGovernmentAnswer": "...", "addendum": "Yes|No|No (capture in contract)|No (unless requirement changes)" }
      ]
    }
  ]
}`;
}

function decideAddendumHeuristic(vendorQuestion, suggestedAnswer) {
  const q = `${vendorQuestion} ${suggestedAnswer}`.toLowerCase();
  const yesSignals = [
    "submission",
    "deadline",
    "cut-off",
    "email",
    "format",
    "file size",
    "scope",
    "included",
    "excluded",
    "integration",
    "interface",
    "api",
    "migration",
    "data",
    "payment",
    "milestone",
    "bond",
    "guarantee",
    "penalty",
    "sla",
    "hosting",
    "environment",
    "uat",
    "acceptance",
  ];
  if (yesSignals.some((s) => q.includes(s))) return "Yes";
  return "No";
}

async function answerAll({ authorityName, projectName, vendorCompanyName, documentText, extractedSections }) {
  const text = String(documentText || "");
  const trimmed =
    text.length <= MAX_DOC_CHARS
      ? text
      : `${text.slice(0, Math.floor(MAX_DOC_CHARS * 0.6))}\n\n--- TRUNCATED ---\n\n${text.slice(-Math.floor(MAX_DOC_CHARS * 0.4))}`;

  const title =
    projectName && projectName.trim()
      ? `Pre-Bid Queries — ${projectName} (draft)`
      : "Pre-Bid Queries — Tender RFP (draft)";

  const baseDescription = `This JSON contains vendor queries submitted by ${
    vendorCompanyName || "the vendor"
  }, suggested authority answers, and a decision on whether each clarification should be included in an official RFP addendum.`;

  const sys = buildAgentSystemPrompt({ authorityName });

  const sectionsOut = [];
  const totalSections = extractedSections.length;
  const totalQueries = extractedSections.reduce((sum, s) => sum + s.rows.length, 0);
  
  console.log(`  📊 Found ${totalQueries} queries across ${totalSections} section${totalSections > 1 ? 's' : ''}`);
  console.log(`  🤖 Generating answers and addendum decisions...`);

  for (let sectionIdx = 0; sectionIdx < extractedSections.length; sectionIdx++) {
    const section = extractedSections[sectionIdx];
    const queryCount = section.rows.length;
    console.log(`  ⏳ Processing section ${sectionIdx + 1}/${totalSections}: "${section.sectionTitle}" (${queryCount} query${queryCount > 1 ? 'ies' : 'y'})...`);
    const userPayload = {
      title,
      vendorCompanyName: vendorCompanyName || null,
      authorityName: authorityName || null,
      instructions:
        "Use the provided document text as the only source of truth. If the document does not specify a detail, say so and provide recommended addendum wording. Return JSON with keys: sectionTitle and rows (with id, vendorQuestion, suggestedGovernmentAnswer, addendum).",
      sectionTitle: section.sectionTitle,
      queries: section.rows,
      documentText: trimmed,
    };

    const { content } = await ollamaChat({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      stream: false,
      options: { temperature: 0 },
    });

    const parsed = safeJsonParse(content);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const repairedRows = [];
    const byId = new Map(section.rows.map((r) => [r.id, r.vendorQuestion]));

    for (const r of rows) {
      const id = Number(r?.id);
      const vendorQuestion = normalizeWhitespace(r?.vendorQuestion || byId.get(id) || "");
      const suggestedGovernmentAnswer = normalizeWhitespace(r?.suggestedGovernmentAnswer || "");
      let addendum = normalizeWhitespace(r?.addendum || "");

      if (!Number.isFinite(id) || !vendorQuestion || !suggestedGovernmentAnswer) continue;

      if (!addendum) addendum = decideAddendumHeuristic(vendorQuestion, suggestedGovernmentAnswer);

      repairedRows.push({
        id,
        vendorQuestion,
        suggestedGovernmentAnswer,
        addendum,
      });
    }

    const seen = new Set(repairedRows.map((r) => r.id));
    for (const original of section.rows) {
      if (!seen.has(original.id)) {
        const vendorQuestion = original.vendorQuestion;
        const suggestedGovernmentAnswer =
          "Not specified in the provided document. Recommendation: Include an addendum clarifying this point to ensure all bidders follow consistent assumptions.";
        const addendum = "Yes";
        repairedRows.push({ id: original.id, vendorQuestion, suggestedGovernmentAnswer, addendum });
      }
    }

    repairedRows.sort((a, b) => a.id - b.id);

    sectionsOut.push({
      sectionTitle: normalizeWhitespace(parsed?.sectionTitle || section.sectionTitle || "All queries") || "All queries",
      rows: repairedRows,
    });
    
    console.log(`  ✓ Section ${sectionIdx + 1}/${totalSections} completed (${repairedRows.length} answers generated)`);
  }
  
  console.log(`  ✅ All sections processed`);

  const output = {
    title,
    description: baseDescription,
    sections: sectionsOut,
  };

  const validated = OutputSchema.parse(output);
  return validated;
}

/* ------------------------------- Orchestration --------------------------- */

export async function analyzePreBidQueries({ buffer, filename, vendorCompanyName, authorityName, projectName }) {
  const startTime = Date.now();
  console.log(`\n🔍 Starting pre-bid query analysis...`);
  
  console.log(`  📥 Ensuring model is available...`);
  await ensureModelPulled(MODEL);
  console.log(`  ✓ Model ready`);

  console.log(`  📄 Extracting text from document...`);
  const text = await extractTextFromBuffer(buffer, filename);
  if (!text || text.length < 40) {
    throw new Error("Could not extract meaningful text from the document.");
  }
  console.log(`  ✓ Extracted ${text.length.toLocaleString()} characters`);

  console.log(`  🔎 Extracting queries using heuristics...`);
  let sections = extractSectionsHeuristically(text);
  const queryCount = sections.reduce((n, s) => n + s.rows.length, 0);
  console.log(`  ✓ Found ${queryCount} queries using heuristics`);
  
  if (queryCount < 3) {
    console.log(`  ⚠️  Few queries found (< 3), falling back to LLM extraction...`);
    sections = await extractSectionsWithLLM(text);
    const llmQueryCount = sections.reduce((n, s) => n + s.rows.length, 0);
    console.log(`  ✓ LLM extraction found ${llmQueryCount} queries`);
  }

  const result = await answerAll({
    authorityName,
    projectName,
    vendorCompanyName,
    documentText: text,
    extractedSections: sections,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Analysis complete in ${elapsed}s\n`);

  return result;
}
