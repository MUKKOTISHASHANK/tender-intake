import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_ENABLED } from "../config/ollamaConfig.js";
import { readDocumentText } from "./documentService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// -------------------- CONFIG --------------------
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || OLLAMA_URL.replace(/\/api$/, "")).replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
const CHUNK_MAX_CHARS = 3000; // Larger chunks, fewer total
const CHUNK_OVERLAP = 300;
const MAX_CHUNKS_TO_EMBED = 30; // Much fewer chunks for speed
const SECTION_EXTRACT_LINES = 200; // Lines after keyword match

// -------------------- UTILS --------------------
function normalizeWhitespace(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text, { maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP } = {}) {
  const t = normalizeWhitespace(text);
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + maxChars);
    const chunk = t.slice(i, end);
    chunks.push(chunk);
    if (end === t.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = str.slice(start, end + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Model output was not valid JSON.");
  }
}

// -------------------- KEYWORD-BASED SECTION DETECTION (FAST, NO AI) --------------------
const KEYWORD_PATTERNS = {
  RFP: [
    /request\s+for\s+proposal/i,
    /instructions\s+to\s+(bidders|vendors|suppliers)/i,
    /proposal\s+submission/i,
    /evaluation\s+criteria/i,
    /technical\s+evaluation/i,
    /financial\s+evaluation/i,
    /terms\s+and\s+conditions/i,
    /commercial\s+terms/i,
    /eligibility\s+requirements/i,
    /administrative\s+requirements/i,
    /project\s+introduction/i,
    /definitions?\s+and\s+abbreviations?/i,
  ],
  SOW: [
    /scope\s+of\s+work/i,
    /statement\s+of\s+work/i,
    /project\s+scope/i,
    /work\s+breakdown/i,
    /deliverables?/i,
    /implementation\s+approach/i,
    /methodology/i,
    /training\s+plan/i,
    /support\s+services?/i,
    /integration\s+requirements?/i,
    /functional\s+requirements?/i,
    /technical\s+requirements?/i,
    /system\s+capabilities?/i,
  ],
  BOQ: [
    /bill\s+of\s+quantities/i,
    /\bboq\b/i,
    /price\s+schedule/i,
    /cost\s+breakdown/i,
    /itemized\s+pricing/i,
    /quantity\s+schedule/i,
    /pricing\s+table/i,
  ],
  BOM: [
    /bill\s+of\s+materials/i,
    /\bbom\b/i,
    /equipment\s+list/i,
    /materials?\s+list/i,
    /hardware\s+list/i,
    /software\s+list/i,
    /components?\s+list/i,
  ],
  BOS: [
    /bill\s+of\s+services/i,
    /\bbos\b/i,
    /service\s+catalog/i,
    /rate\s+card/i,
    /professional\s+services/i,
    /service\s+level/i,
    /sla/i,
  ],
};

function findSectionsByKeywords(text) {
  const lines = text.split("\n");
  const sections = {
    RFP: [],
    SOW: [],
    BOQ: [],
    BOM: [],
    BOS: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const [type, patterns] of Object.entries(KEYWORD_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          const startIdx = i;
          const endIdx = Math.min(lines.length, i + SECTION_EXTRACT_LINES);
          const sectionText = lines.slice(startIdx, endIdx).join("\n");
          
          // Avoid duplicates
          const existing = sections[type].find(s => 
            Math.abs(s.startLine - startIdx) < 50
          );
          
          if (!existing) {
            sections[type].push({
              startLine: startIdx,
              endLine: endIdx,
              text: sectionText,
            });
          }
          break;
        }
      }
    }
  }

  // Combine sections for each type
  const combined = {};
  for (const [type, foundSections] of Object.entries(sections)) {
    if (foundSections.length > 0) {
      foundSections.sort((a, b) => a.startLine - b.startLine);
      combined[type] = foundSections.map(s => s.text).join("\n\n---\n\n");
    } else {
      combined[type] = null;
    }
  }

  return combined;
}

function extractRelevantSections(text) {
  // Fast keyword-based section detection
  const keywordSections = findSectionsByKeywords(text);
  
  // Also extract first 5000 chars (intro) and last 5000 chars (appendix/BOQ) - smaller for speed
  const introSection = text.substring(0, 5000);
  const endSection = text.substring(Math.max(0, text.length - 5000));
  
  // Combine: keyword sections + intro + end
  const relevantTexts = {
    RFP: keywordSections.RFP || introSection,
    SOW: keywordSections.SOW || introSection,
    BOQ: keywordSections.BOQ || endSection,
    BOM: keywordSections.BOM || endSection,
    BOS: keywordSections.BOS || endSection,
  };

  // Ensure minimum content and limit size aggressively for speed
  for (const [type, section] of Object.entries(relevantTexts)) {
    if (!section || section.length < 200) {
      relevantTexts[type] = type === "RFP" || type === "SOW" ? introSection : endSection;
    }
    // Aggressively limit size for fast processing (2000 chars max per section)
    if (relevantTexts[type].length > 2000) {
      relevantTexts[type] = relevantTexts[type].substring(0, 2000) + "\n\n[... truncated ...]";
    }
  }

  return relevantTexts;
}

// -------------------- OLLAMA API --------------------
async function ollamaEmbeddings({ model, input, maxRetries = 2 }) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is not enabled");
  }

  const url = `${OLLAMA_BASE_URL}/api/embeddings`;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ollama embeddings error ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const emb =
        data?.embedding ||
        (Array.isArray(data?.data) && data.data[0]?.embedding) ||
        null;

      if (!Array.isArray(emb)) {
        throw new Error("Embeddings response missing embedding vector.");
      }

      return emb;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

async function ollamaChat({ model, messages, temperature = 0, maxRetries = 2 }) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is not enabled");
  }

  const url = `${OLLAMA_BASE_URL}/api/chat`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: { temperature },
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ollama chat error ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const content = data?.message?.content;

      if (typeof content !== "string") {
        throw new Error("Chat response missing message.content");
      }

      return content;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

// -------------------- FAST SEMANTIC REFINEMENT (OPTIONAL) --------------------
async function quickSemanticRefinement(sections, departmentName) {
  // Only if we have small sections, do quick semantic search
  const allSectionText = Object.values(sections)
    .filter(s => s && s.length > 0)
    .join("\n\n---SECTION---\n\n");
  
  if (allSectionText.length > 50000) {
    // Too large, skip semantic search
    return sections;
  }

  const chunks = chunkText(allSectionText, { maxChars: CHUNK_MAX_CHARS, overlap: CHUNK_OVERLAP });
  
  if (chunks.length > MAX_CHUNKS_TO_EMBED) {
    // Too many chunks, skip semantic search
    return sections;
  }

  console.log(`   Quick semantic refinement on ${chunks.length} chunks...`);
  
  // Embed chunks in parallel batches (faster)
  const vectors = [];
  const batchSize = 5;
  for (let i = 0; i < Math.min(chunks.length, MAX_CHUNKS_TO_EMBED); i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchVectors = await Promise.all(
      batch.map(chunk => ollamaEmbeddings({ model: MODEL, input: chunk }).catch(() => new Array(768).fill(0)))
    );
    vectors.push(...batchVectors);
  }

  // Quick search for each artifact type
  const queries = {
    RFP: `request for proposal instructions bidders evaluation criteria terms conditions ${departmentName}`,
    SOW: `scope of work deliverables implementation approach requirements ${departmentName}`,
    BOQ: `bill of quantities BOQ items prices quantities units`,
    BOM: `bill of materials BOM equipment hardware specifications`,
    BOS: `bill of services BOS rates service levels`,
  };

  const refined = { ...sections };
  
  // Helper for cosine similarity
  function cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }
  
  for (const [type, query] of Object.entries(queries)) {
    try {
      const qv = await ollamaEmbeddings({ model: MODEL, input: query });
      const scored = vectors.map((v, i) => ({
        i,
        score: cosineSim(v, qv),
      }));
      scored.sort((a, b) => b.score - a.score);
      const topChunks = scored.slice(0, 5).map(s => chunks[s.i]).join("\n\n");
      
      if (topChunks.length > 500) {
        refined[type] = (refined[type] || "") + "\n\n---SEMANTIC_MATCHES---\n\n" + topChunks;
      }
    } catch (error) {
      // Skip semantic refinement if it fails
      console.error(`   Warning: Semantic refinement failed for ${type}, using keyword sections`);
    }
  }

  return refined;
}

// -------------------- SCHEMA --------------------
const OUTPUT_SCHEMA = `{
  "RFP": {
    "present": "yes/no",
    "project_introduction": "",
    "definitions": "",
    "instructions_to_bidders": "",
    "administrative_requirements": "",
    "eligibility_PQC_requirements": "",
    "technical_evaluation_criteria": "",
    "financial_evaluation_criteria": "",
    "proposal_submission_instructions": "",
    "commercial_terms_and_conditions": "",
    "general_terms_conditions": "",
    "functional_requirements_matrix": "",
    "technical_requirements_matrix": "",
    "fee_schedule_summary": "",
    "appendices_list": [],
    "boq_summary_reference": ""
  },
  "SOW": {
    "present": "yes/no",
    "high_level_scope": "",
    "detailed_scope": "",
    "modules_or_functional_areas": [],
    "departments_covered": [],
    "in_scope_tasks": [],
    "out_of_scope_tasks": [],
    "deliverables": [],
    "training_plan": "",
    "support_services": "",
    "integration_requirements": [],
    "implementation_approach": "",
    "system_capabilities": "",
    "functional_requirements": "",
    "technical_requirements": "",
    "compliance_tables_reference": ""
  },
  "BOQ": {
    "present": "yes/no",
    "items": [],
    "categories_identified": [],
    "boq_total": ""
  },
  "BOM": {
    "present": "yes/no",
    "materials": [],
    "bom_total": ""
  },
  "BOS": {
    "present": "yes/no",
    "services": [],
    "bos_total": ""
  }
}`;

// -------------------- MAIN EXTRACTION (OPTIMIZED FOR SPEED) --------------------
export async function extractArtifactsFromPdf(filePath, departmentName, originalFileName = null) {
  // STEP 1: Read document (supports both PDF and DOCX)
  console.log(`📄 Reading document: ${path.basename(filePath)}`);
  const fullText = await readDocumentText(filePath, originalFileName);
  const normalizedText = normalizeWhitespace(fullText);
  
  if (normalizedText.length < 50) {
    throw new Error("No readable text extracted from document.");
  }

  console.log(`✅ Document text length: ${normalizedText.length} characters`);

  // STEP 2: Fast keyword-based section detection (instant, no AI)
  console.log(`🔍 Step 1: Fast keyword-based section detection...`);
  const relevantSections = extractRelevantSections(normalizedText);
  
  const sectionSizes = Object.entries(relevantSections).map(([k, v]) => 
    `${k}:${v ? Math.round(v.length/1000) : 0}K`
  ).join(", ");
  console.log(`✅ Found sections: ${sectionSizes}`);

  // STEP 3: Skip semantic refinement for speed - use keyword sections directly
  const finalSections = relevantSections;
  console.log(`⚡ Step 2: Using keyword sections directly (fast mode)`);

  // STEP 4: Split into 2 parallel calls for speed (RFP/SOW together, BOQ/BOM/BOS together)
  console.log(`🤖 Step 3: Extracting structured data (2 parallel calls)...`);
  
  const systemPrompt = `Extract tender data. Output JSON ONLY. Use exact schema keys.
Rules: "present":"yes/no". If "no", only include "present". If "yes", fill all fields.
Extract ALL items in arrays. Use "" for missing strings, [] for missing arrays. No invented data.`;

  // Call 1: RFP + SOW (text-heavy sections) - limit to 2000 chars each for speed
  const rfpSowPrompt = `Extract RFP and SOW. Schema: ${OUTPUT_SCHEMA}

Department: ${departmentName || "Not specified"}

RFP:
${(finalSections.RFP || "No RFP").substring(0, 2000)}

SOW:
${(finalSections.SOW || "No SOW").substring(0, 2000)}

Extract ALL fields. Arrays: extract ALL items.`;

  // Call 2: BOQ + BOM + BOS (structured data) - limit to 2000 chars each for speed
  const boqBomBosPrompt = `Extract BOQ, BOM, BOS. Schema: ${OUTPUT_SCHEMA}

Department: ${departmentName || "Not specified"}

BOQ:
${(finalSections.BOQ || "No BOQ").substring(0, 2000)}

BOM:
${(finalSections.BOM || "No BOM").substring(0, 2000)}

BOS:
${(finalSections.BOS || "No BOS").substring(0, 2000)}

Extract ALL items/materials/services with complete details.`;

  // Execute both calls in parallel
  const [rfpSowRaw, boqBomBosRaw] = await Promise.all([
    ollamaChat({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: rfpSowPrompt },
      ],
    }),
    ollamaChat({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: boqBomBosPrompt },
      ],
    }),
  ]);

  // Parse and merge results
  const rfpSowResult = safeJsonParse(rfpSowRaw);
  const boqBomBosResult = safeJsonParse(boqBomBosRaw);
  
  const raw = JSON.stringify({
    RFP: rfpSowResult.RFP || { present: "no" },
    SOW: rfpSowResult.SOW || { present: "no" },
    BOQ: boqBomBosResult.BOQ || { present: "no" },
    BOM: boqBomBosResult.BOM || { present: "no" },
    BOS: boqBomBosResult.BOS || { present: "no" },
  });

  const json = safeJsonParse(raw);

  // Validate and ensure present field
  const requiredTop = ["RFP", "SOW", "BOQ", "BOM", "BOS"];
  for (const k of requiredTop) {
    if (!json[k]) {
      json[k] = { present: "no" };
    }
    if (json[k].present !== "yes" && json[k].present !== "no") {
      const hasContent = Object.values(json[k]).some((v, idx) => {
        if (idx === 0) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === "string") return v.trim().length > 0;
        return false;
      });
      json[k].present = hasContent ? "yes" : "no";
    }
    if (json[k].present === "no") {
      json[k] = { present: "no" };
    }
  }

  console.log(`✅ Extraction complete`);
  return json;
}
