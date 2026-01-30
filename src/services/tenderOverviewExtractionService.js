import fs from "fs";
import path from "path";
import { z } from "zod";
import { readDocumentText } from "./documentService.js";
import { OLLAMA_URL, OLLAMA_MODEL } from "../config/ollamaConfig.js";

/* ----------------------------- Config ----------------------------- */

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || OLLAMA_URL.replace(/\/api$/, "")).replace(/\/$/, "");
const OLLAMA_PULL_URL = `${OLLAMA_BASE_URL}/api/pull`;
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;
const MODEL = process.env.OLLAMA_MODEL || OLLAMA_MODEL;

const NOT_SPECIFIED = "Not specified in the document.";

/* ----------------------------- Schema Template ----------------------------- */
/**
 * This is the canonical structure that must ALWAYS remain intact.
 * We will deep-merge LLM output into this.
 */
function getTenderTemplate() {
  return {
    tenderOverview: {
      header: {
        title: "Tender Evaluation Framework",
        subtitle: NOT_SPECIFIED,
      },
      overview: {
        evaluationWeighting: {
          title: "Evaluation Weighting",
          description: NOT_SPECIFIED,
          data: [],
        },
        keyRequirements: {
          title: "Key Requirements",
          description: NOT_SPECIFIED,
          requirements: [
            { label: "Project Duration", value: NOT_SPECIFIED },
            { label: "Minimum Company Experience", value: NOT_SPECIFIED },
            { label: "Named Users", value: NOT_SPECIFIED },
            { label: "Licenses", value: NOT_SPECIFIED },
          ],
        },
        evaluationScoringSystem: {
          title: "Evaluation Scoring System",
          description: NOT_SPECIFIED,
          financialScoring: {
            title: "Financial Scoring",
            rules: [NOT_SPECIFIED],
          },
          technicalScoring: {
            title: "Technical Scoring",
            rules: [NOT_SPECIFIED],
          },
        },
      },
      financial: {
        title: "Financial Evaluation Criteria",
        weight: 0,
        weightUnit: "percentage",
        evaluationFactors: [
          { order: 1, title: NOT_SPECIFIED, description: NOT_SPECIFIED },
        ],
        disqualificationTriggers: [NOT_SPECIFIED],
      },
      technical: {
        title: "Technical Evaluation Criteria",
        weight: 0,
        weightUnit: "percentage",
        scoringScale: NOT_SPECIFIED,
        technicalCriteria: [
          { category: NOT_SPECIFIED, weight: 0 },
        ],
        psdRequirements: [NOT_SPECIFIED],
        disqualificationTriggers: [NOT_SPECIFIED],
      },
      compliance: {
        title: "Mandatory Compliance Requirements",
        description: "Pass/Fail - Non-Negotiable",
        generalSubmissionCompliance: [NOT_SPECIFIED],
        technicalComplianceRequirements: [NOT_SPECIFIED],
        technicalComplianceNote: NOT_SPECIFIED,
        teamComplianceRequirements: [
          { title: NOT_SPECIFIED, description: NOT_SPECIFIED },
        ],
        oracleLicensingCompliance: {
          note: NOT_SPECIFIED,
        },
      },
      support: {
        title: "Support & Service Level Agreements",
        description: "Operational requirements and SLAs",
        supportAvailability: {
          systemAvailabilityRequirement: 0,
          supportHours: [
            { type: "Regular", schedule: NOT_SPECIFIED },
          ],
        },
        incidentResponseTimes: [
          { priority: NOT_SPECIFIED, responseTime: NOT_SPECIFIED },
        ],
        severityLevels: [
          { level: 1, description: NOT_SPECIFIED },
        ],
        backupAndDisasterRecovery: [
          { type: NOT_SPECIFIED, period: NOT_SPECIFIED },
        ],
        reliabilityRequirement: NOT_SPECIFIED,
      },
    },
  };
}

/* ----------------------------- Zod Validation (Soft) ----------------------------- */
/**
 * We validate types loosely to detect gross failures, but we always repair into template.
 */
const TenderSchemaLoose = z.object({
  tenderOverview: z.object({
    header: z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
    }).optional(),
    overview: z.object({
      evaluationWeighting: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        data: z.array(z.object({
          name: z.string(),
          value: z.number(),
        })).optional(),
      }).optional(),
      keyRequirements: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        requirements: z.array(z.object({
          label: z.string(),
          value: z.union([z.string(), z.number()]),
        })).optional(),
      }).optional(),
      evaluationScoringSystem: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        financialScoring: z.object({
          title: z.string().optional(),
          rules: z.array(z.string()).optional(),
        }).optional(),
        technicalScoring: z.object({
          title: z.string().optional(),
          rules: z.array(z.string()).optional(),
        }).optional(),
      }).optional(),
    }).optional(),
    financial: z.object({
      title: z.string().optional(),
      weight: z.number().optional(),
      weightUnit: z.string().optional(),
      evaluationFactors: z.array(z.object({
        order: z.number(),
        title: z.string(),
        description: z.string(),
      })).optional(),
      disqualificationTriggers: z.array(z.string()).optional(),
    }).optional(),
    technical: z.object({
      title: z.string().optional(),
      weight: z.number().optional(),
      weightUnit: z.string().optional(),
      scoringScale: z.string().optional(),
      technicalCriteria: z.array(z.object({
        category: z.string(),
        weight: z.number(),
      })).optional(),
      psdRequirements: z.array(z.string()).optional(),
      disqualificationTriggers: z.array(z.string()).optional(),
    }).optional(),
    compliance: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      generalSubmissionCompliance: z.array(z.string()).optional(),
      technicalComplianceRequirements: z.array(z.string()).optional(),
      technicalComplianceNote: z.string().optional(),
      teamComplianceRequirements: z.array(z.object({
        title: z.string(),
        description: z.string(),
      })).optional(),
      oracleLicensingCompliance: z.object({
        note: z.string().optional(),
      }).optional(),
    }).optional(),
    support: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      supportAvailability: z.object({
        systemAvailabilityRequirement: z.number().optional(),
        supportHours: z.array(z.object({
          type: z.string(),
          schedule: z.string(),
        })).optional(),
      }).optional(),
      incidentResponseTimes: z.array(z.object({
        priority: z.string(),
        responseTime: z.string(),
      })).optional(),
      severityLevels: z.array(z.object({
        level: z.number(),
        description: z.string(),
      })).optional(),
      backupAndDisasterRecovery: z.array(z.object({
        type: z.string(),
        period: z.string(),
      })).optional(),
      reliabilityRequirement: z.string().optional(),
    }).optional(),
  }).optional(),
});

/* ----------------------------- Utilities ----------------------------- */

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Deep merge that:
 * - preserves template keys ONLY (removes extra keys from candidate)
 * - overwrites template values with actual values where present
 * - ensures arrays are arrays (if LLM gives bad types, keep template)
 */
function deepMergeIntoTemplate(template, candidate) {
  if (Array.isArray(template)) {
    // If candidate is a valid array, use it; else keep template.
    return Array.isArray(candidate) ? candidate : template;
  }
  if (!isObject(template)) {
    // primitive
    return candidate === undefined || candidate === null ? template : candidate;
  }

  const out = { ...template };
  const cand = isObject(candidate) ? candidate : {};

  // Only merge keys that exist in the template - ignore extra keys
  for (const key of Object.keys(template)) {
    out[key] = deepMergeIntoTemplate(template[key], cand[key]);
  }

  // DO NOT add extra keys - strict template enforcement
  return out;
}

/**
 * Normalize obvious fields:
 * - Ensure NOT_SPECIFIED for empty strings/nulls
 * - Ensure numeric fields are numbers
 */
function normalizeTenderJson(obj) {
  // Helper to walk
  function walk(node) {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (isObject(node)) {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = walk(v);
      }
      return out;
    }
    if (node === null || node === undefined) return NOT_SPECIFIED;
    if (typeof node === "string" && node.trim() === "") return NOT_SPECIFIED;
    return node;
  }
  return walk(obj);
}

/**
 * Normalize weights to ensure they add up correctly:
 * - financial.weight + technical.weight should equal 100 (or close, then normalize)
 * - technicalCriteria weights should add up to 100 (or close, then normalize)
 * - evaluationWeighting.data values should add up to 100 (or close, then normalize)
 */
function normalizeWeights(obj) {
  const result = JSON.parse(JSON.stringify(obj)); // deep clone

  // Normalize financial + technical weights to sum to 100
  const financialWeight = result.tenderOverview?.financial?.weight || 0;
  const technicalWeight = result.tenderOverview?.technical?.weight || 0;
  const totalWeight = financialWeight + technicalWeight;

  if (totalWeight > 0 && Math.abs(totalWeight - 100) > 1) {
    // Normalize to sum to 100
    if (result.tenderOverview.financial) {
      result.tenderOverview.financial.weight = Math.round((financialWeight / totalWeight) * 100);
    }
    if (result.tenderOverview.technical) {
      result.tenderOverview.technical.weight = Math.round((technicalWeight / totalWeight) * 100);
    }
  } else if (totalWeight === 0) {
    // If no weights found, set defaults (70 technical, 30 financial)
    if (result.tenderOverview.financial) {
      result.tenderOverview.financial.weight = 30;
    }
    if (result.tenderOverview.technical) {
      result.tenderOverview.technical.weight = 70;
    }
  }

  // Normalize evaluationWeighting.data to sum to 100
  const evalData = result.tenderOverview?.overview?.evaluationWeighting?.data;
  if (Array.isArray(evalData) && evalData.length > 0) {
    const sum = evalData.reduce((acc, item) => acc + (item.value || 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 1) {
      evalData.forEach((item) => {
        item.value = Math.round((item.value / sum) * 100);
      });
    }
  }

  // Normalize technicalCriteria weights to sum to 100
  const techCriteria = result.tenderOverview?.technical?.technicalCriteria;
  if (Array.isArray(techCriteria) && techCriteria.length > 0) {
    const sum = techCriteria.reduce((acc, item) => acc + (item.weight || 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 1) {
      techCriteria.forEach((item) => {
        item.weight = Math.round((item.weight / sum) * 100);
      });
    }
  }

  return result;
}

/**
 * Apply hardcoded defaults when fields are missing or set to NOT_SPECIFIED
 */
function applyHardcodedDefaults(obj) {
  const result = JSON.parse(JSON.stringify(obj)); // deep clone

  // Helper to check if value is missing/not specified
  const isMissing = (val) => !val || val === NOT_SPECIFIED || (Array.isArray(val) && val.length === 0);

  // Overview - Evaluation Weighting
  if (result.tenderOverview?.overview?.evaluationWeighting) {
    const ew = result.tenderOverview.overview.evaluationWeighting;
    if (ew.title === NOT_SPECIFIED) ew.title = "Evaluation Weighting";
    if (ew.description === NOT_SPECIFIED) {
      ew.description = "Overall criteria distribution based on the requirements outlined in the RFP.";
    }
    if (!ew.data || ew.data.length === 0) {
      ew.data = [
        { name: "Technical", value: 70 },
        { name: "Financial", value: 30 }
      ];
    }
  }

  // Overview - Key Requirements
  if (result.tenderOverview?.overview?.keyRequirements) {
    const kr = result.tenderOverview.overview.keyRequirements;
    if (kr.title === NOT_SPECIFIED) kr.title = "Key Requirements";
    if (kr.description === NOT_SPECIFIED) {
      kr.description = "Mandatory qualifications and requirements for vendors.";
    }
    if (!kr.requirements || kr.requirements.length === 0) {
      kr.requirements = [
        { label: "Project Duration", value: NOT_SPECIFIED },
        { label: "Minimum Company Experience", value: NOT_SPECIFIED },
        { label: "Named Users", value: NOT_SPECIFIED },
        { label: "Licenses", value: NOT_SPECIFIED }
      ];
    }
  }

  // Overview - Evaluation Scoring System
  if (result.tenderOverview?.overview?.evaluationScoringSystem) {
    const ess = result.tenderOverview.overview.evaluationScoringSystem;
    if (ess.title === NOT_SPECIFIED) ess.title = "Evaluation Scoring System";
    if (ess.description === NOT_SPECIFIED) {
      ess.description = "Comprehensive scoring methodology";
    }
    if (ess.financialScoring) {
      if (ess.financialScoring.title === NOT_SPECIFIED) {
        ess.financialScoring.title = "Financial Scoring";
      }
      if (!ess.financialScoring.rules || 
          (ess.financialScoring.rules.length === 1 && ess.financialScoring.rules[0] === NOT_SPECIFIED)) {
        ess.financialScoring.rules = [
          "Lowest bidder scoring logic applies.",
          "Proportional scoring based on total bid amount."
        ];
      }
    }
    if (ess.technicalScoring) {
      if (ess.technicalScoring.title === NOT_SPECIFIED) {
        ess.technicalScoring.title = "Technical Scoring";
      }
      if (!ess.technicalScoring.rules || 
          (ess.technicalScoring.rules.length === 1 && ess.technicalScoring.rules[0] === NOT_SPECIFIED)) {
        ess.technicalScoring.rules = [
          "Scale of 1–10 per category.",
          "Weighted nature with pass/fail conditions for mandatory compliance."
        ];
      }
    }
  }

  // Financial
  if (result.tenderOverview?.financial) {
    const fin = result.tenderOverview.financial;
    if (fin.title === NOT_SPECIFIED || fin.title === "Financial Evaluation") {
      fin.title = "Financial Evaluation Criteria";
    }
    if (!fin.weight || fin.weight === 0) fin.weight = 30;
    if (!fin.weightUnit) fin.weightUnit = "percentage";
    if (!fin.evaluationFactors || fin.evaluationFactors.length === 0) {
      fin.evaluationFactors = [
        {
          order: 1,
          title: "Cost Competitiveness",
          description: "Evaluation of the overall cost of the proposal."
        },
        {
          order: 2,
          title: "Payment Terms",
          description: "Review of payment terms and conditions."
        }
      ];
    }
    if (!fin.disqualificationTriggers || fin.disqualificationTriggers.length === 0) {
      fin.disqualificationTriggers = [
        "Missing financial documents",
        "Unrealistic or non-compliant pricing"
      ];
    }
  }

  // Technical
  if (result.tenderOverview?.technical) {
    const tech = result.tenderOverview.technical;
    if (tech.title === NOT_SPECIFIED || tech.title === "Technical Evaluation") {
      tech.title = "Technical Evaluation Criteria";
    }
    if (!tech.weight || tech.weight === 0) tech.weight = 70;
    if (!tech.weightUnit) tech.weightUnit = "percentage";
    if (tech.scoringScale === NOT_SPECIFIED) {
      tech.scoringScale = "1–10 per category";
    }
    if (!tech.technicalCriteria || tech.technicalCriteria.length === 0) {
      tech.technicalCriteria = [
        { category: "Functional Requirements", weight: 40 },
        { category: "Implementation Plan", weight: 30 },
        { category: "Team Experience", weight: 30 }
      ];
    }
    if (!tech.psdRequirements || tech.psdRequirements.length === 0) {
      tech.psdRequirements = [
        "Methodology completeness",
        "Alignment with standards",
        "Experience with modules",
        "Execution roadmap"
      ];
    }
    if (!tech.disqualificationTriggers || tech.disqualificationTriggers.length === 0) {
      tech.disqualificationTriggers = [
        "Major gaps vs RFP",
        "Missing compliance responses",
        "Weak team, lack of certifications"
      ];
    }
  }

  // Compliance
  if (result.tenderOverview?.compliance) {
    const comp = result.tenderOverview.compliance;
    if (comp.title === NOT_SPECIFIED || comp.title === "Compliance Requirements") {
      comp.title = "Mandatory Compliance Requirements";
    }
    if (!comp.description || comp.description === NOT_SPECIFIED) {
      comp.description = "Pass/Fail - Non-Negotiable";
    }
    if (!comp.generalSubmissionCompliance || comp.generalSubmissionCompliance.length === 0) {
      comp.generalSubmissionCompliance = [
        "Language requirements: Arabic and English",
        "Envelope structure must be adhered to",
        "Acknowledgement of receipt required",
        "Completion of appendices is mandatory",
        "Proposal validity for 90 days"
      ];
    }
    if (!comp.technicalComplianceRequirements || comp.technicalComplianceRequirements.length === 0) {
      comp.technicalComplianceRequirements = [
        "Process compliance",
        "Functional compliance",
        "Technical compliance"
      ];
    }
    if (comp.technicalComplianceNote === NOT_SPECIFIED) {
      comp.technicalComplianceNote = "Empty cells = automatically treated as NO.";
    }
    if (!comp.teamComplianceRequirements || comp.teamComplianceRequirements.length === 0) {
      comp.teamComplianceRequirements = [
        {
          title: "Key Personnel Experience",
          description: "Minimum 5 years of relevant experience in similar projects."
        }
      ];
    }
    if (comp.oracleLicensingCompliance && comp.oracleLicensingCompliance.note === NOT_SPECIFIED) {
      comp.oracleLicensingCompliance.note = NOT_SPECIFIED;
    }
  }

  // Support
  if (result.tenderOverview?.support) {
    const sup = result.tenderOverview.support;
    if (sup.title === NOT_SPECIFIED || sup.title === "Support and Service Level Requirements") {
      sup.title = "Support & Service Level Agreements";
    }
    if (!sup.description || sup.description === NOT_SPECIFIED) {
      sup.description = "Operational requirements and SLAs";
    }
    if (sup.supportAvailability) {
      if (!sup.supportAvailability.systemAvailabilityRequirement || sup.supportAvailability.systemAvailabilityRequirement === 0) {
        sup.supportAvailability.systemAvailabilityRequirement = 99.5;
      }
      if (!sup.supportAvailability.supportHours || sup.supportAvailability.supportHours.length === 0) {
        sup.supportAvailability.supportHours = [
          { type: "Regular", schedule: "Sunday to Thursday, 8 AM - 5 PM" }
        ];
      } else {
        // Fix if schedule is missing
        sup.supportAvailability.supportHours.forEach(sh => {
          if (sh.schedule === NOT_SPECIFIED) {
            sh.schedule = "Sunday to Thursday, 8 AM - 5 PM";
          }
        });
      }
    }
    if (!sup.incidentResponseTimes || sup.incidentResponseTimes.length === 0) {
      sup.incidentResponseTimes = [
        { priority: "High", responseTime: "Immediate response required" },
        { priority: "Medium", responseTime: "Response within 4 hours" }
      ];
    }
    if (!sup.severityLevels || sup.severityLevels.length === 0) {
      sup.severityLevels = [
        { level: 1, description: "Critical outage" },
        { level: 2, description: "Major degradation" },
        { level: 3, description: "Minor impact" }
      ];
    }
    if (!sup.backupAndDisasterRecovery || sup.backupAndDisasterRecovery.length === 0) {
      sup.backupAndDisasterRecovery = [
        { type: "Daily Backup", period: "Retention for 30 days" }
      ];
    }
    if (sup.reliabilityRequirement === NOT_SPECIFIED) {
      sup.reliabilityRequirement = "System must not break more than 3 times per year.";
    }
  }

  return result;
}

/* ----------------------------- Ollama Client ----------------------------- */

async function ollamaPullModel() {
  // Pull is idempotent. If model exists, it typically completes quickly.
  const res = await fetch(OLLAMA_PULL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: MODEL }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama /api/pull failed: ${res.status} ${res.statusText}\n${t}`);
  }

  // streaming logs possible; we just consume
  await res.text().catch(() => "");
}

async function ollamaChat(messages, { temperature = 0.0 } = {}) {
  const res = await fetch(OLLAMA_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: { temperature },
      // Ensure we prefer JSON output behavior:
      format: "json",
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama /api/chat failed: ${res.status} ${res.statusText}\n${t}`);
  }

  const data = await res.json();
  // Ollama chat response commonly: { message: { role, content }, ... }
  const content = data?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Ollama response missing message.content");
  }
  return content;
}

/* ----------------------------- Prompting Strategy ----------------------------- */
/**
 * We use a two-pass approach:
 * Pass A: ask for JSON in fixed schema
 * Pass B: if parsing fails, ask model to return STRICT minified valid JSON only
 *
 * IMPORTANT:
 * - We send the extracted document text (chunked if huge)
 * - We instruct: output ONLY JSON, no markdown
 */

function buildSystemPrompt() {
  return `
You are an expert Tender Extraction agent.

ABSOLUTE RULES:
- Read the entire tender/RFP document content provided in the messages.
- Output ONLY a single valid JSON object (no markdown, no commentary).
- Preserve numeric details exactly (dates, times, percentages, points, fees, AED, years, months, days, SLAs).
- Preserve disqualification / pass-fail triggers.
- If something is missing, set it to exactly: "${NOT_SPECIFIED}"
- Do NOT invent scores or compute any evaluation results. Only extract what document states.
- DO NOT add any fields that are not in the template structure below.
- For weights: Extract actual weights from document. If not found, use reasonable defaults (e.g., Technical: 70, Financial: 30) ensuring they sum to 100.

STRICT OUTPUT STRUCTURE - ONLY THESE FIELDS:
{
  "tenderOverview": {
    "header": {
      "title": "Tender Evaluation Framework",
      "subtitle": "..."
    },
    "overview": {
      "evaluationWeighting": { "title": "...", "description": "...", "data": [...] },
      "keyRequirements": { "title": "...", "description": "...", "requirements": [...] },
      "evaluationScoringSystem": { "title": "...", "description": "...", "financialScoring": {...}, "technicalScoring": {...} }
    },
    "financial": {
      "title": "...",
      "weight": number,
      "weightUnit": "percentage",
      "evaluationFactors": [...],
      "disqualificationTriggers": [...]
    },
    "technical": {
      "title": "...",
      "weight": number,
      "weightUnit": "percentage",
      "scoringScale": "...",
      "technicalCriteria": [...],
      "psdRequirements": [...],
      "disqualificationTriggers": [...]
    },
    "compliance": {
      "title": "...",
      "description": "...",
      "generalSubmissionCompliance": [...],
      "technicalComplianceRequirements": [...],
      "technicalComplianceNote": "...",
      "teamComplianceRequirements": [...],
      "oracleLicensingCompliance": { "note": "..." }
    },
    "support": {
      "title": "...",
      "description": "...",
      "supportAvailability": { "systemAvailabilityRequirement": number, "supportHours": [...] },
      "incidentResponseTimes": [...],
      "severityLevels": [...],
      "backupAndDisasterRecovery": [...],
      "reliabilityRequirement": "..."
    }
  }
}

DO NOT add any other fields. Return only JSON matching this exact structure.
`.trim();
}

function buildUserPrompt({ dept, title }) {
  return `
Department Name: ${dept}
RFP Title/Reference: ${title}

TASK:
Extract and map the tender/RFP content into the required JSON structure.

Remember:
- If a field isn't stated in the document, use "${NOT_SPECIFIED}".
- Keep numbers as numbers where applicable (weights/percentages/systemAvailabilityRequirement).
- Output only JSON.
`.trim();
}

/* ----------------------------- Chunking ----------------------------- */

function chunkText(text, maxChars = 12000) {
  // Conservative chunking to avoid model/context issues.
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const slice = text.slice(i, i + maxChars);
    chunks.push(slice);
    i += maxChars;
  }
  return chunks;
}

/* ----------------------------- JSON Parsing + Repair ----------------------------- */

function extractJsonFromString(s) {
  // Most reliable: find first "{" and last "}" and parse that.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object boundaries found in model output.");
  }
  const jsonStr = s.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

async function forceStrictJsonRepair(rawModelOutput) {
  const messages = [
    { role: "system", content: "You are a JSON repair tool. Return ONLY valid JSON. No extra text." },
    { role: "user", content: `Fix this into STRICT valid JSON object only:\n\n${rawModelOutput}` },
  ];
  const repaired = await ollamaChat(messages, { temperature: 0.0 });
  return extractJsonFromString(repaired);
}

/* ----------------------------- Main Export ----------------------------- */

/**
 * Extract tender overview from a document file
 * @param {Object} options
 * @param {string} options.filePath - Path to the document file (PDF, DOCX, etc.)
 * @param {string} [options.departmentName] - Department name
 * @param {string} [options.rfpTitle] - RFP title/reference
 * @param {string} [options.originalFileName] - Original filename for logging
 * @returns {Promise<Object>} Tender overview JSON structure
 */
export async function extractTenderOverview({ filePath, departmentName, rfpTitle, originalFileName }) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const dept = departmentName || NOT_SPECIFIED;
  const title = rfpTitle || NOT_SPECIFIED;

  console.log(`1) Pulling model if needed: ${MODEL}`);
  await ollamaPullModel();

  console.log("2) Extracting document text...");
  const docText = await readDocumentText(absPath, originalFileName);

  if (!docText || docText.length < 50) {
    throw new Error("Extracted text is too short; document might be scanned image-only. Use OCR pipeline if needed.");
  }

  // Clean the text
  const cleaned = docText
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If the document is very large, send in chunks as multiple user messages
  const chunks = chunkText(cleaned, 12000);

  console.log(`3) Calling Ollama for extraction (chunks: ${chunks.length})...`);

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt({ dept, title }) },
    // Provide document chunks
    ...chunks.map((c, idx) => ({
      role: "user",
      content: `DOCUMENT CHUNK ${idx + 1}/${chunks.length}:\n${c}`,
    })),
    { role: "user", content: "Now produce the final JSON output ONLY." },
  ];

  let modelOutput = await ollamaChat(messages, { temperature: 0.0 });

  let parsed;
  try {
    parsed = extractJsonFromString(modelOutput);
  } catch (e) {
    console.warn("⚠️ Initial JSON parse failed. Attempting repair with Ollama...");
    parsed = await forceStrictJsonRepair(modelOutput);
  }

  // Soft validate
  const result = TenderSchemaLoose.safeParse(parsed);
  if (!result.success) {
    console.warn("⚠️ Output failed loose schema validation. Will still repair into template.");
  }

  // Enforce template structure ALWAYS
  const template = getTenderTemplate();
  const merged = deepMergeIntoTemplate(template, parsed);
  const normalized = normalizeTenderJson(merged);
  const weightNormalized = normalizeWeights(normalized);
  const withDefaults = applyHardcodedDefaults(weightNormalized);

  // Ensure header.title fixed
  withDefaults.tenderOverview.header.title = "Tender Evaluation Framework";

  // Ensure subtitle best-effort if missing
  // Format: "RFP_Title - Department" or just "Title - Department"
  if (!withDefaults.tenderOverview.header.subtitle || withDefaults.tenderOverview.header.subtitle === NOT_SPECIFIED) {
    if (title !== NOT_SPECIFIED && dept !== NOT_SPECIFIED) {
      // Format title with RFP_ prefix if not already present
      const formattedTitle = title.toUpperCase().includes("RFP") ? title : `RFP_${title}`;
      withDefaults.tenderOverview.header.subtitle = `${formattedTitle} - ${dept}`;
    } else if (title !== NOT_SPECIFIED) {
      const formattedTitle = title.toUpperCase().includes("RFP") ? title : `RFP_${title}`;
      withDefaults.tenderOverview.header.subtitle = formattedTitle;
    } else if (dept !== NOT_SPECIFIED) {
      withDefaults.tenderOverview.header.subtitle = dept;
    } else {
      withDefaults.tenderOverview.header.subtitle = NOT_SPECIFIED;
    }
  }

  // Final weight normalization after applying defaults
  const final = normalizeWeights(withDefaults);

  return final;
}
