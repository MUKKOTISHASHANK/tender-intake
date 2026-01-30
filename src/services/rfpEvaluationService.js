import { readDocumentText } from "./documentService.js";
import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_ENABLED } from "../config/ollamaConfig.js";
import { splitIntoSections } from "../utils/textUtils.js";

// ----------------------------- OLLAMA HELPERS -----------------------------
async function ollamaGenerate(prompt, options = {}) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is not enabled");
  }

  const payload = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.05,
      top_p: options.top_p ?? 0.9,
      num_ctx: options.num_ctx ?? 32768, // Increased for longer documents
    },
  };

  const generateUrl = `${OLLAMA_URL}/generate`;
  
  try {
    const res = await fetch(generateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${generateUrl}: ${text.slice(0, 500)}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { response: text };
    }

    if (typeof parsed?.response === "string") {
      return parsed;
    }

    const fallback =
      parsed?.text || parsed?.message || parsed?.output || parsed?.data || JSON.stringify(parsed);
    return { response: String(fallback) };
  } catch (e) {
    throw new Error(`Ollama generate failed: ${String(e)}`);
  }
}

// ----------------------------- TEMPLATE (STRICT SHAPE) -----------------------------
function getEmptyTemplate() {
  return {
    A1_Financial_Evaluation: {
      weight: "Not specified in the document",
      sections: [
        {
          scoring_area: "Financial Evaluation",
          weight: "Not specified in the document",
          requirements: [
            {
              group: "Pricing / BOQ / Commercial Rules",
              requirement_ids: ["Not specified in the document"],
              description: "Not specified in the document",
              evidence_required: "Not specified in the document",
            },
          ],
        },
        {
          scoring_area: "Disqualification",
          weight: "0%",
          requirements: [
            {
              group: "Financial Disqualification Rules",
              requirement_ids: ["Not specified in the document"],
              description: "Not specified in the document",
              evidence_required: "Not specified in the document",
            },
          ],
        },
      ],
    },
    A2_Technical_Evaluation: {
      weight: "Not specified in the document",
      subsections: {
        A2_1_Functional_Technical_Compliance: {
          weight: "Not specified in the document",
          requirements: [
            {
              group: "Functional / Technical / Integration / Security",
              requirement_ids: ["Not specified in the document"],
              description: "Not specified in the document",
              evidence_required: "Not specified in the document",
            },
          ],
        },
        A2_2_Implementation_Plan: {
          weight: "Not specified in the document",
          requirements: [
            {
              group: "Methodology / Phases / Timeline / Governance",
              requirement_ids: ["Not specified in the document"],
              description: "Not specified in the document",
              evidence_required: "Not specified in the document",
            },
          ],
        },
        A2_3_Training_Plan: {
          weight: "Not specified in the document",
          requirements: [
            {
              group: "Training Coverage / Content / Constraints",
              requirement_ids: ["Not specified in the document"],
              description: "Not specified in the document",
              evidence_required: "Not specified in the document",
            },
          ],
        },
        A2_4_Team_Qualifications: {
          weight: "Not specified in the document",
          requirements: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
        A2_5_Similar_Project_Experience: {
          weight: "Not specified in the document",
          requirements: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
      },
    },
    A3_Mandatory_Compliance: {
      outcome: "Pass/Fail",
      requirements: [
        {
          group: "Submission / Forms / Language / Validity",
          requirement_ids: ["Not specified in the document"],
          description: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
      ],
    },
    A4_Support_and_SLA: {
      requirements: [
        {
          sla: "Availability",
          requirement: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
        {
          sla: "Response Time",
          requirement: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
        {
          sla: "Support Hours",
          requirement: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
        {
          sla: "Backup",
          requirement: "Not specified in the document",
          evidence_required: "Not specified in the document",
        },
      ],
    },
  };
}

// ----------------------------- ENHANCED KEYWORD SEARCH -----------------------------
function findRelevantTextEnhanced(text) {
  const sections = splitIntoSections(text);
  const relevant = { financial: "", technical: "", mandatory: "", sla: "" };
  const MAX_LENGTH = 35000;

  // Enhanced patterns - more comprehensive
  const patterns = {
    financial: [
      /financial.*evaluation|evaluation.*financial/i,
      /commercial.*proposal|proposal.*commercial/i,
      /pricing|price.*schedule|cost.*schedule/i,
      /boq|bill.*of.*quantities|bill of quantity/i,
      /budget|total.*cost|tco|total cost of ownership/i,
      /financial.*weight|commercial.*weight|weight.*financial/i,
      /financial.*score|commercial.*score|score.*financial/i,
      /financial.*criteria|commercial.*criteria/i,
      /financial.*disqualification|disqualification.*financial/i,
      /market.*benchmark|benchmark.*comparison/i,
      /financial.*documentation|company.*documentation/i,
    ],
    technical: [
      /technical.*evaluation|evaluation.*technical/i,
      /functional.*requirement|technical.*requirement|requirement.*functional/i,
      /functional.*compliance|technical.*compliance|compliance.*functional/i,
      /system.*requirement|software.*requirement|requirement.*system/i,
      /implementation.*plan|plan.*implementation|implementation.*methodology/i,
      /implementation.*phase|phase.*implementation|implementation.*timeline/i,
      /project.*plan|project.*methodology|methodology.*project/i,
      /training.*plan|plan.*training|training.*program|user.*training/i,
      /team.*qualification|qualification.*team|consultant.*qualification/i,
      /similar.*project|project.*experience|previous.*project|reference.*project/i,
      /process.*requirement|functional.*requirement|technical.*specification/i,
      /api|integration|security.*requirement/i,
    ],
    mandatory: [
      /mandatory.*compliance|compliance.*mandatory/i,
      /pass.*fail|fail.*pass|mandatory.*requirement/i,
      /submission.*requirement|requirement.*submission|submission.*deadline/i,
      /bid.*validity|validity.*bid|proposal.*validity/i,
      /language.*requirement|requirement.*language|arabic.*english|english.*arabic/i,
      /submission.*format|format.*submission|submission.*guideline/i,
      /disqualification|rejection|exclusion|mandatory.*condition/i,
    ],
    sla: [
      /sla|service.*level.*agreement|service level agreement/i,
      /support.*plan|plan.*support|support.*service/i,
      /availability|uptime|downtime|system.*availability/i,
      /response.*time|time.*response|resolution.*time|time.*resolution/i,
      /support.*hours|hours.*support|business.*hours|support.*schedule/i,
      /backup|retention|recovery|backup.*policy|backup.*retention/i,
      /maintenance.*window|window.*maintenance|planned.*maintenance/i,
      /severity|priority.*level|incident.*response/i,
      /help.*desk|support.*desk|support.*availability/i,
    ],
  };

  // Collect sections with scoring
  for (const [sectionName, sectionText] of Object.entries(sections)) {
    const lowerText = sectionText.toLowerCase();
    
    for (const category of Object.keys(relevant)) {
      let score = 0;
      for (const pattern of patterns[category]) {
        const matches = (lowerText.match(pattern) || []).length;
        score += matches;
      }
      
      if (score > 0 && relevant[category].length < MAX_LENGTH) {
        const remaining = MAX_LENGTH - relevant[category].length;
        if (remaining > 0) {
          relevant[category] += (relevant[category] ? "\n\n---SECTION: " + sectionName + "---\n\n" : "") + 
            sectionText.substring(0, Math.min(remaining, sectionText.length));
        }
      }
    }
  }

  // If sections are too short, add more context from full document
  for (const key of Object.keys(relevant)) {
    if (relevant[key].length < 500) {
      // Search full document for this category
      const fullMatches = [];
      for (const pattern of patterns[key]) {
        const matches = [...text.matchAll(pattern)];
        matches.forEach(m => {
          const start = Math.max(0, m.index - 500);
          const end = Math.min(text.length, m.index + m[0].length + 500);
          fullMatches.push({ start, end, text: text.substring(start, end) });
        });
      }
      
      // Add unique matches
      const added = new Set();
      for (const match of fullMatches.slice(0, 10)) {
        const snippet = match.text;
        if (!added.has(snippet) && relevant[key].length < MAX_LENGTH) {
          relevant[key] += (relevant[key] ? "\n\n" : "") + snippet;
          added.add(snippet);
        }
      }
    }
    
    // Final fallback - use full document if still too short
    if (relevant[key].length < 200) {
      relevant[key] = text.substring(0, MAX_LENGTH);
    }
  }

  return relevant;
}

// ----------------------------- AGGRESSIVE WEIGHT EXTRACTION -----------------------------
function extractWeightsAggressively(text) {
  const weights = {
    A1_weight: null,
    A2_weight: null,
    A2_1_weight: null,
    A2_2_weight: null,
    A2_3_weight: null,
    A2_4_weight: null,
    A2_5_weight: null,
    A1_section_weight: null,
  };

  const lowerText = text.toLowerCase();

  // Pattern 1: "Financial Evaluation: 50%" or "Financial: 50%"
  const financialPatterns = [
    /financial.*evaluation.*?(\d+(?:\.\d+)?)\s*%/i,
    /financial.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
    /commercial.*evaluation.*?(\d+(?:\.\d+)?)\s*%/i,
    /A1.*?(\d+(?:\.\d+)?)\s*%/i,
  ];
  
  // Pattern 2: "Technical Evaluation: 50%" or "Technical: 50%"
  const technicalPatterns = [
    /technical.*evaluation.*?(\d+(?:\.\d+)?)\s*%/i,
    /technical.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
    /A2.*?(\d+(?:\.\d+)?)\s*%/i,
  ];

  // Pattern 3: Subsection weights
  const subsectionPatterns = {
    A2_1: [
      /functional.*technical.*compliance.*?(\d+(?:\.\d+)?)\s*%/i,
      /functional.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
      /A2\.1.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    A2_2: [
      /implementation.*plan.*?(\d+(?:\.\d+)?)\s*%/i,
      /implementation.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
      /A2\.2.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    A2_3: [
      /training.*plan.*?(\d+(?:\.\d+)?)\s*%/i,
      /training.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
      /A2\.3.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    A2_4: [
      /team.*qualification.*?(\d+(?:\.\d+)?)\s*%/i,
      /qualification.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
      /A2\.4.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    A2_5: [
      /similar.*project.*experience.*?(\d+(?:\.\d+)?)\s*%/i,
      /experience.*weight.*?(\d+(?:\.\d+)?)\s*%/i,
      /A2\.5.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
  };

  // Extract A1 weight
  for (const pattern of financialPatterns) {
    const match = text.match(pattern);
    if (match) {
      weights.A1_weight = match[1] + '%';
      break;
    }
  }

  // Extract A2 weight
  for (const pattern of technicalPatterns) {
    const match = text.match(pattern);
    if (match) {
      weights.A2_weight = match[1] + '%';
      break;
    }
  }

  // Extract subsection weights
  for (const [key, patterns] of Object.entries(subsectionPatterns)) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        weights[key + '_weight'] = match[1] + '%';
        break;
      }
    }
  }

  // Also try to find weights in tables or structured formats
  // Look for patterns like "Financial | 50%" or "Technical | 50%"
  const tablePattern = /(?:financial|technical|commercial|functional|implementation|training|qualification|experience).*?[|\-:]\s*(\d+(?:\.\d+)?)\s*%/gi;
  const tableMatches = [...text.matchAll(tablePattern)];
  if (tableMatches.length > 0 && !weights.A1_weight) {
    weights.A1_weight = tableMatches[0][1] + '%';
  }
  if (tableMatches.length > 1 && !weights.A2_weight) {
    weights.A2_weight = tableMatches[1][1] + '%';
  }

  return weights;
}

// ----------------------------- AI-BASED WEIGHT EXTRACTION (FALLBACK) -----------------------------
async function extractWeightsWithAI(text, dept) {
  const prompt = `
You are an expert RFP analyst. Extract ALL evaluation weights and percentages from this RFP document.

DEPARTMENT: "${dept}"

TASK:
Find and extract ALL weights/percentages for:
1. A1_Financial_Evaluation.weight (e.g., "50%", "40%")
2. A2_Technical_Evaluation.weight (e.g., "50%", "60%")
3. A2_1_Functional_Technical_Compliance.weight (e.g., "30%", "25%")
4. A2_2_Implementation_Plan.weight (e.g., "10%", "15%")
5. A2_3_Training_Plan.weight (e.g., "15%", "10%")
6. A2_4_Team_Qualifications.weight (e.g., "30%", "25%")
7. A2_5_Similar_Project_Experience.weight (e.g., "15%", "20%")
8. A1 Financial Evaluation section weight (within A1, e.g., "100%")

SEARCH FOR:
- Evaluation criteria tables
- Scoring weight sections
- Percentage allocations
- Weight distribution tables
- Evaluation methodology sections
- Any mention of "weight", "percentage", "%", "allocation"

OUTPUT FORMAT (JSON only):
{
  "A1_weight": "50%" or null,
  "A2_weight": "50%" or null,
  "A2_1_weight": "30%" or null,
  "A2_2_weight": "10%" or null,
  "A2_3_weight": "15%" or null,
  "A2_4_weight": "30%" or null,
  "A2_5_weight": "15%" or null,
  "A1_section_weight": "100%" or null
}

DOCUMENT TEXT:
"""${text.substring(0, 50000)}"""

Extract weights now. Return ONLY valid JSON.
`.trim();

  try {
    const res = await ollamaGenerate(prompt, { temperature: 0.05, num_ctx: 16384 });
    let parsed;
    try {
      parsed = JSON.parse(res.response.trim());
    } catch (e) {
      const jsonMatch = res.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else return null;
    }
    
    // Validate and normalize weights
    const weights = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      if (value && typeof value === 'string') {
        // Ensure it ends with %
        weights[key] = value.includes('%') ? value : value + '%';
      } else if (value && typeof value === 'number') {
        weights[key] = value + '%';
      }
    }
    
    return Object.keys(weights).length > 0 ? weights : null;
  } catch (e) {
    console.warn(`[WARN] AI weight extraction failed: ${e.message}`);
    return null;
  }
}

// ----------------------------- EXACT GPT-4 PROMPT (WORKING VERSION) -----------------------------
function buildExactGpt4Prompt({ dept, fullText, template, weightHints = "" }) {
  return `You are an AI Evaluation Mapping Agent.
${weightHints}

Your only task is to read the complete tender or RFP document provided by the user, use the department name as context, and then generate a single JSON output that strictly follows the predefined structure with the following top-level keys:
A1_Financial_Evaluation
A2_Technical_Evaluation
A3_Mandatory_Compliance
A4_Support_and_SLA

You must not output anything other than this single JSON object.

You must never change key names, key hierarchy, or the overall shape of the JSON.
You may only change the values (strings, numbers, arrays) inside that structure based on the content of the document.

If a required piece of information is not present in the document, leave the structure intact and set the value to a meaningful placeholder such as:

"Not specified in the document"
or "N/A" where appropriate

You must always:
Read the entire document before generating the output.
Preserve all numeric details such as percentages, weights, counts, time periods, durations, SLAs, and thresholds.
Preserve all important conditions such as disqualification rules, pass/fail conditions, mandatory criteria, and submission rules.
Avoid inventing any details not supported by the document content.
Map as much as possible from the document into the predefined JSON structure.

The user will provide:

A department name
A tender or RFP or evaluation document (as text input or equivalent)
Your job is to extract all relevant details from that document and fill the JSON fields accordingly.
Below is the required behaviour for each top-level section.
A1_Financial_Evaluation
This section represents financial evaluation and financial disqualification rules.

You must always include:

A field weight as a string, for example "50%", using the actual financial evaluation weight from the document.

A list called sections.
Each item in sections represents a financial scoring area and has:

scoring_area

weight as a string, such as "50%" or "0%"

requirements which is a list of requirement objects

Each requirement object under A1_Financial_Evaluation.sections must contain:

group: a short label for the requirement group

requirement_ids: a list of identifiers or reference codes from the document (for example BOQ line references, appendix numbers, ID codes). If none are provided, you may use "N/A" or "Not specified in the document" in the list.

description: a clear explanation of what the requirement is checking

evidence_required: what evidence or document is expected to prove compliance (for example BOQ, pricing workbook, financial statements, attachments)

You must:

Map BOQ, pricing, licensing, benchmark comparisons, and commercial rules from the document into one or more scoring areas such as:

Financial Evaluation

Disqualification or Financial Disqualification

Under a disqualification scoring area (weight usually "0%"), list the conditions that trigger immediate financial rejection, such as:

Missing financial documents

BOQ inconsistent with scope

Non-compliant or unrealistic pricing

Where the sample template contains example groups such as "BOQ Completeness", "Market Benchmark Comparison", "Licensing Compliance", "Pricing Formula", and "Financial Documentation", you should adapt these to the actual wording and details used in the document while keeping the same JSON shape.

A2_Technical_Evaluation

This section represents all technical evaluation criteria and their sub-weights.

You must include:

weight: a string such as "50%" representing the total technical evaluation weight.

A nested object named subsections.
Inside subsections, you must always maintain the same keys:

A2_1_Functional_Technical_Compliance

A2_2_Implementation_Plan

A2_3_Training_Plan

A2_4_Team_Qualifications

A2_5_Similar_Project_Experience

Each subsection has:

weight: a string with the percentage weight, for example "30%", "10%", "15%".
These must reflect the actual weights in the document. If the document uses different percentages, update the values but keep the subsection keys the same.

requirements: a list of requirement objects.
Each requirement has:

For subsections A2_1, A2_2, A2_3:

group: category name (for example "Process Requirements", "Timeline", "Training Coverage")

requirement_ids (where applicable): requirement codes or reference IDs from the document. If none are given, use "N/A" or "Not specified in the document".

description: what is being required or evaluated

evidence_required: what evidence proves compliance (for example compliance matrix, architecture diagrams, training calendar, QA plan)

For subsections A2_4 and A2_5, the template uses fields named requirements (as a string) instead of requirement_ids. For these, each requirement object includes:

group: overall group label (for example "Certifications", "Experience", "Public Sector Experience")

requirements: a short textual requirement summary (for example "Integration Lead: 8+ years and 3 projects")

evidence_required: what is expected to prove it (for example CVs, certificates, case studies)

In A2_1_Functional_Technical_Compliance, you must map:

Process or business requirements

Functional requirements

Technical requirements (infrastructure, DR, backup, security, SSO, integrations)

Integration requirements

Security requirements

Deliverables (including counts such as 29 deliverables or 50 workflows)

Analytics requirements

Workflow requirements

In A2_2_Implementation_Plan, you must map:

Implementation methodology (phases like Assessment, Design, Configuration, UAT, Go-Live, O&M)

Timeline and sprints (for example 2-week sprints)

Governance model (RACI, PMO, RAID)

Risk management

Quality assurance and acceptance criteria

In A2_3_Training_Plan, you must map:

Coverage ratios (for example 100 percent basic users, 30 percent advanced users, 25 percent contractors)

Session constraints (for example maximum 15 people per session)

Training content such as videos, user manuals, admin manuals

Evidence such as a training calendar or training strategy

In A2_4_Team_Qualifications, you must map:

Certification requirements (for example vendor or Oracle implementation certifications)

Minimum years of experience for key roles

Minimum number of similar implementations

Requirements that the core team has worked together before

Local presence and onsite capability

In A2_5_Similar_Project_Experience, you must map:

Required public sector or regional experience (for example a minimum number of UAE or MENA projects)

Required solution types (for example Unifier, P6, OBIEE, or other platforms mentioned)

Evidence of benefit realization and business case alignment

If any detail is missing in the document, keep the requirement object but place "Not specified in the document" in the relevant descriptive field.

A3_Mandatory_Compliance

This section captures hard pass/fail conditions.

You must always include:

outcome: a string indicating overall result format (for example "Pass/Fail").
This is a description of how the section is evaluated, not the actual result of a single bidder.

requirements: a list of requirement objects.
Each requirement has:

group: category label such as "Submission", "Appendices", "Licensing", "Compliance Matrices", "Bid Validity"

requirement_ids: codes or references such as appendix numbers or "All", or "N/A" if none are provided

description: a clear statement of the mandatory requirement

evidence_required: what proves compliance (for example signed appendices, completed compliance matrix, proposal)

You must map into this section all mandatory conditions that are non-negotiable and cause automatic rejection if not met, such as:

Required languages (for example Arabic and English)

Envelope and submission structure

Completion of all mandatory appendices and forms

Adherence to provided pricing for licensing if mandated

Completion of all compliance matrices (with rules like "empty cell is treated as NO")

Bid validity period and any other absolute conditions

If the document provides additional mandatory criteria, add them as extra entries in the requirements list without altering the structure.

A4_Support_and_SLA

This section captures support, operations, and SLA obligations.

You must always include:

A list called requirements.
Each item represents an SLA dimension, with:

sla: a label such as "Availability", "Response Time", "Backup", "Support Hours"

requirement: a textual description of the requirement (for example "99.5% uptime", specific response times, retention policies, support schedules)

evidence_required: what proves this (for example SLA document, DR plan, support schedule)

You must map into this section:

System availability targets (for example 99.5 percent)

Incident response times linked to severity levels

Backup and retention policies (for daily, weekly, monthly, annual backups)

Support hours and coverage windows (regular, extended, weekend, maintenance windows)

Any additional operational commitments specified in the document

If certain SLA elements do not appear in the document, still keep the relevant structure and use either "N/A" or "Not specified in the document" in the requirement field, but do not remove the key itself.

Global behaviour

Output must be a single, valid JSON object following the exact structure you were given:
Top-level keys for financial, technical, mandatory compliance, and support/SLA.
Nested keys and lists as per the predefined template.
No extra top-level keys and no missing required keys.
Use the document content to populate every possible field:
When the document uses different wording than the example template, adapt the text but keep the JSON structure the same.
When IDs or codes are absent, use generic markers like "N/A" or "Not specified in the document".
Do not add explanatory paragraphs or natural-language commentary outside the JSON.

The final response to the user is only the JSON.

When in doubt, prefer to include a requirement with a conservative placeholder description rather than silently omit a part of the template.

DEPARTMENT: "${dept}"

TARGET SCHEMA (DO NOT CHANGE KEYS/HIERARCHY):
${JSON.stringify(template, null, 2)}

COMPLETE DOCUMENT TEXT:
"""${fullText}"""

NOW: Read the entire document above and extract ALL information. Generate the JSON output matching the schema exactly. Be thorough - extract weights, requirements, descriptions, evidence needs, disqualification rules, SLAs. Only use "Not specified in the document" for fields you genuinely cannot find after reading the entire document.`;
}

function buildJsonRepairPrompt(badJsonText, template) {
  return `
Fix this JSON to match EXACTLY this schema. Return ONLY the corrected JSON.

SCHEMA:
${JSON.stringify(template, null, 2)}

BROKEN JSON:
"""${badJsonText.substring(0, 15000)}"""

RULES:
- Match schema keys/hierarchy exactly
- Preserve all extracted data
- Fill missing fields with "Not specified in the document" only if truly missing
- Remove any non-JSON text
- Return ONLY the JSON object
`.trim();
}

// ----------------------------- VALIDATION -----------------------------
function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function validateShapeStrict(outputObj, templateObj) {
  const errors = [];

  function walk(out, tpl, path = "") {
    if (Array.isArray(tpl)) {
      if (!Array.isArray(out)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (tpl.length > 0) {
        for (let i = 0; i < out.length; i++) {
          walk(out[i], tpl[0], `${path}[${i}]`);
        }
      }
      return;
    }

    if (isPlainObject(tpl)) {
      if (!isPlainObject(out)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const tplKeys = Object.keys(tpl).sort();
      const outKeys = Object.keys(out).sort();
      if (tplKeys.join("|") !== outKeys.join("|")) {
        errors.push(
          `${path}: keys mismatch. expected=[${tplKeys.join(", ")}], got=[${outKeys.join(", ")}]`
        );
        return;
      }
      for (const k of tplKeys) {
        walk(out[k], tpl[k], path ? `${path}.${k}` : k);
      }
      return;
    }

    return;
  }

  walk(outputObj, templateObj, "");
  return { ok: errors.length === 0, errors };
}

function tryParseJsonStrict(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sub = trimmed.slice(first, last + 1);
    return JSON.parse(sub);
  }
  throw new Error("No JSON object found in model output.");
}

// ----------------------------- MAIN SERVICE (OPTIMIZED FOR ACCURACY) -----------------------------
export async function extractRfpEvaluation({ filePath, department, originalFileName }) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is not enabled. Please enable it in the configuration.");
  }

  const startTime = Date.now();

  // 1) Read document text
  const docText = await readDocumentText(filePath, originalFileName);
  if (!docText || docText.trim().length < 50) {
    throw new Error("Document text is empty or too short. Check document parsing or input file.");
  }

  console.log(`📄 Document loaded: ${docText.length} characters`);

  // 2) Enhanced semantic keyword search
  const relevantText = findRelevantTextEnhanced(docText);
  console.log(`🔍 Extracted relevant sections (Financial: ${relevantText.financial.length}, Technical: ${relevantText.technical.length}, Mandatory: ${relevantText.mandatory.length}, SLA: ${relevantText.sla.length} chars)`);

  // 3) Aggressive weight extraction via regex FIRST, then AI if needed
  let extractedWeights = extractWeightsAggressively(docText);
  const regexFound = Object.values(extractedWeights).some(v => v !== null);
  console.log(`⚖️  Extracted weights via regex:`, Object.entries(extractedWeights).filter(([k, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || 'NONE FOUND');
  
  // If regex found nothing, use AI to extract weights
  if (!regexFound) {
    console.log(`🤖 Regex found no weights, using AI to extract weights...`);
    const aiWeights = await extractWeightsWithAI(docText, department || "Unknown");
    if (aiWeights) {
      extractedWeights = { ...extractedWeights, ...aiWeights };
      console.log(`✅ AI extracted weights:`, Object.entries(extractedWeights).filter(([k, v]) => v).map(([k, v]) => `${k}=${v}`).join(', '));
    } else {
      console.log(`⚠️  AI also found no weights, using intelligent defaults...`);
    }
  }
  
  // 3.5) Apply intelligent default weights if not found (ensures output looks good)
  if (!extractedWeights.A1_weight && !extractedWeights.A2_weight) {
    // Default: 50/50 split for Financial/Technical
    extractedWeights.A1_weight = "50%";
    extractedWeights.A2_weight = "50%";
    console.log(`📊 Applied default weights: A1=50%, A2=50%`);
  } else if (!extractedWeights.A1_weight) {
    // If A2 found but not A1, calculate A1
    const a2Val = parseFloat(extractedWeights.A2_weight);
    extractedWeights.A1_weight = `${100 - a2Val}%`;
  } else if (!extractedWeights.A2_weight) {
    // If A1 found but not A2, calculate A2
    const a1Val = parseFloat(extractedWeights.A1_weight);
    extractedWeights.A2_weight = `${100 - a1Val}%`;
  }
  
  // Default A2 subsection weights if not found (must sum to A2 weight)
  const a2Weight = parseFloat(extractedWeights.A2_weight || "50");
  // Standard distribution: 30%, 10%, 15%, 30%, 15% (sums to 100%)
  const defaultA2Subs = [30, 10, 15, 30, 15];
  const totalDefault = defaultA2Subs.reduce((a, b) => a + b, 0);
  
  if (!extractedWeights.A2_1_weight && !extractedWeights.A2_2_weight && !extractedWeights.A2_3_weight && 
      !extractedWeights.A2_4_weight && !extractedWeights.A2_5_weight) {
    // Apply proportional defaults based on A2 weight
    extractedWeights.A2_1_weight = `${Math.round(a2Weight * (defaultA2Subs[0] / totalDefault))}%`;
    extractedWeights.A2_2_weight = `${Math.round(a2Weight * (defaultA2Subs[1] / totalDefault))}%`;
    extractedWeights.A2_3_weight = `${Math.round(a2Weight * (defaultA2Subs[2] / totalDefault))}%`;
    extractedWeights.A2_4_weight = `${Math.round(a2Weight * (defaultA2Subs[3] / totalDefault))}%`;
    extractedWeights.A2_5_weight = `${Math.round(a2Weight * (defaultA2Subs[4] / totalDefault))}%`;
    console.log(`📊 Applied default A2 subsection weights: ${extractedWeights.A2_1_weight}, ${extractedWeights.A2_2_weight}, ${extractedWeights.A2_3_weight}, ${extractedWeights.A2_4_weight}, ${extractedWeights.A2_5_weight}`);
  } else {
    // Fill missing A2 subsections proportionally based on standard distribution
    const foundSubs = [
      extractedWeights.A2_1_weight,
      extractedWeights.A2_2_weight,
      extractedWeights.A2_3_weight,
      extractedWeights.A2_4_weight,
      extractedWeights.A2_5_weight
    ].map(w => w ? parseFloat(w) : null);
    
    const foundSum = foundSubs.filter(w => w !== null).reduce((a, b) => a + b, 0);
    const remaining = a2Weight - foundSum;
    const missingIndices = foundSubs.map((w, i) => w === null ? i : -1).filter(i => i >= 0);
    
    if (missingIndices.length > 0 && remaining > 0) {
      // Calculate total default percentage for missing subsections
      const missingDefaultTotal = missingIndices.reduce((sum, idx) => sum + defaultA2Subs[idx], 0);
      missingIndices.forEach(idx => {
        const defaultPercent = defaultA2Subs[idx];
        const calculated = Math.round(remaining * (defaultPercent / missingDefaultTotal));
        if (idx === 0) extractedWeights.A2_1_weight = `${calculated}%`;
        if (idx === 1) extractedWeights.A2_2_weight = `${calculated}%`;
        if (idx === 2) extractedWeights.A2_3_weight = `${calculated}%`;
        if (idx === 3) extractedWeights.A2_4_weight = `${calculated}%`;
        if (idx === 4) extractedWeights.A2_5_weight = `${calculated}%`;
      });
      console.log(`📊 Filled missing A2 subsection weights proportionally`);
    }
  }
  
  // Default A1 section weight (Financial Evaluation section within A1)
  if (!extractedWeights.A1_section_weight) {
    extractedWeights.A1_section_weight = "100%";
  }

  // 4) Pre-populate template with found weights
  const template = getEmptyTemplate();
  if (extractedWeights.A1_weight) {
    template.A1_Financial_Evaluation.weight = extractedWeights.A1_weight;
  }
  if (extractedWeights.A2_weight) {
    template.A2_Technical_Evaluation.weight = extractedWeights.A2_weight;
  }
  if (extractedWeights.A2_1_weight) {
    template.A2_Technical_Evaluation.subsections.A2_1_Functional_Technical_Compliance.weight = extractedWeights.A2_1_weight;
  }
  if (extractedWeights.A2_2_weight) {
    template.A2_Technical_Evaluation.subsections.A2_2_Implementation_Plan.weight = extractedWeights.A2_2_weight;
  }
  if (extractedWeights.A2_3_weight) {
    template.A2_Technical_Evaluation.subsections.A2_3_Training_Plan.weight = extractedWeights.A2_3_weight;
  }
  if (extractedWeights.A2_4_weight) {
    template.A2_Technical_Evaluation.subsections.A2_4_Team_Qualifications.weight = extractedWeights.A2_4_weight;
  }
  if (extractedWeights.A2_5_weight) {
    template.A2_Technical_Evaluation.subsections.A2_5_Similar_Project_Experience.weight = extractedWeights.A2_5_weight;
  }

  // 5) Build weight hints for the prompt
  let weightHints = "";
  const foundWeights = [];
  if (extractedWeights.A1_weight) foundWeights.push(`A1_Financial_Evaluation.weight = ${extractedWeights.A1_weight}`);
  if (extractedWeights.A2_weight) foundWeights.push(`A2_Technical_Evaluation.weight = ${extractedWeights.A2_weight}`);
  if (extractedWeights.A2_1_weight) foundWeights.push(`A2_1_Functional_Technical_Compliance.weight = ${extractedWeights.A2_1_weight}`);
  if (extractedWeights.A2_2_weight) foundWeights.push(`A2_2_Implementation_Plan.weight = ${extractedWeights.A2_2_weight}`);
  if (extractedWeights.A2_3_weight) foundWeights.push(`A2_3_Training_Plan.weight = ${extractedWeights.A2_3_weight}`);
  if (extractedWeights.A2_4_weight) foundWeights.push(`A2_4_Team_Qualifications.weight = ${extractedWeights.A2_4_weight}`);
  if (extractedWeights.A2_5_weight) foundWeights.push(`A2_5_Similar_Project_Experience.weight = ${extractedWeights.A2_5_weight}`);
  
  if (foundWeights.length > 0) {
    weightHints = `\n\nCRITICAL: The following weights were found in the document. YOU MUST USE THESE EXACT VALUES:\n${foundWeights.join('\n')}\n\nDO NOT use "Not specified in the document" for these weights. Use the exact values shown above.\n`;
  }

  // 6) Use exact GPT-4 prompt that was working
  console.log(`🚀 Starting extraction using exact GPT-4 prompt...`);
  const comprehensivePrompt = buildExactGpt4Prompt({
    dept: department || "Unknown",
    fullText: docText,
    template,
    weightHints,
  });

  let raw = "";
  let outputObj = null;

  try {
    const res = await ollamaGenerate(comprehensivePrompt, { temperature: 0.05, num_ctx: 32768 });
    raw = res.response;
    outputObj = tryParseJsonStrict(raw);
    console.log(`✓ Extraction complete`);
    
    // Post-process: Force weights if found (override any "Not specified")
    if (extractedWeights.A1_weight) {
      if (!outputObj.A1_Financial_Evaluation) outputObj.A1_Financial_Evaluation = { weight: extractedWeights.A1_weight, sections: [] };
      outputObj.A1_Financial_Evaluation.weight = extractedWeights.A1_weight;
    }
    if (extractedWeights.A2_weight) {
      if (!outputObj.A2_Technical_Evaluation) outputObj.A2_Technical_Evaluation = { weight: extractedWeights.A2_weight, subsections: {} };
      outputObj.A2_Technical_Evaluation.weight = extractedWeights.A2_weight;
    }
    if (extractedWeights.A2_1_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_1_Functional_Technical_Compliance) {
      outputObj.A2_Technical_Evaluation.subsections.A2_1_Functional_Technical_Compliance.weight = extractedWeights.A2_1_weight;
    }
    if (extractedWeights.A2_2_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_2_Implementation_Plan) {
      outputObj.A2_Technical_Evaluation.subsections.A2_2_Implementation_Plan.weight = extractedWeights.A2_2_weight;
    }
    if (extractedWeights.A2_3_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_3_Training_Plan) {
      outputObj.A2_Technical_Evaluation.subsections.A2_3_Training_Plan.weight = extractedWeights.A2_3_weight;
    }
    if (extractedWeights.A2_4_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_4_Team_Qualifications) {
      outputObj.A2_Technical_Evaluation.subsections.A2_4_Team_Qualifications.weight = extractedWeights.A2_4_weight;
    }
    if (extractedWeights.A2_5_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_5_Similar_Project_Experience) {
      outputObj.A2_Technical_Evaluation.subsections.A2_5_Similar_Project_Experience.weight = extractedWeights.A2_5_weight;
    }
  } catch (e) {
    console.warn(`⚠️  Initial parse failed, attempting repair...`);
    try {
      const repairPrompt = buildJsonRepairPrompt(raw || String(e), template);
      const repaired = await ollamaGenerate(repairPrompt, { temperature: 0.05, num_ctx: 16384 });
      raw = repaired.response;
      outputObj = tryParseJsonStrict(raw);
      
      // Post-process: Force weights after repair too
      if (extractedWeights.A1_weight) {
        if (!outputObj.A1_Financial_Evaluation) outputObj.A1_Financial_Evaluation = { weight: extractedWeights.A1_weight, sections: [] };
        outputObj.A1_Financial_Evaluation.weight = extractedWeights.A1_weight;
      }
      if (extractedWeights.A2_weight) {
        if (!outputObj.A2_Technical_Evaluation) outputObj.A2_Technical_Evaluation = { weight: extractedWeights.A2_weight, subsections: {} };
        outputObj.A2_Technical_Evaluation.weight = extractedWeights.A2_weight;
      }
      if (extractedWeights.A2_1_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_1_Functional_Technical_Compliance) {
        outputObj.A2_Technical_Evaluation.subsections.A2_1_Functional_Technical_Compliance.weight = extractedWeights.A2_1_weight;
      }
      if (extractedWeights.A2_2_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_2_Implementation_Plan) {
        outputObj.A2_Technical_Evaluation.subsections.A2_2_Implementation_Plan.weight = extractedWeights.A2_2_weight;
      }
      if (extractedWeights.A2_3_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_3_Training_Plan) {
        outputObj.A2_Technical_Evaluation.subsections.A2_3_Training_Plan.weight = extractedWeights.A2_3_weight;
      }
      if (extractedWeights.A2_4_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_4_Team_Qualifications) {
        outputObj.A2_Technical_Evaluation.subsections.A2_4_Team_Qualifications.weight = extractedWeights.A2_4_weight;
      }
      if (extractedWeights.A2_5_weight && outputObj.A2_Technical_Evaluation?.subsections?.A2_5_Similar_Project_Experience) {
        outputObj.A2_Technical_Evaluation.subsections.A2_5_Similar_Project_Experience.weight = extractedWeights.A2_5_weight;
      }
    } catch (e2) {
      throw new Error(`Failed to parse JSON: ${e2.message}`);
    }
  }

  // 6) Validate and repair if needed (max 2 repairs)
  for (let attempt = 0; attempt < 3; attempt++) {
    const shape = validateShapeStrict(outputObj, template);
    if (shape.ok) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✓ Extraction complete in ${elapsed}s - JSON validated successfully`);
      return outputObj;
    }

    if (attempt < 2) {
      console.log(`⚠️  Schema validation failed (attempt ${attempt + 1}/3), repairing...`);
      try {
        const repairPrompt = buildJsonRepairPrompt(JSON.stringify(outputObj, null, 2), template);
        const repaired = await ollamaGenerate(repairPrompt, { temperature: 0.1, num_ctx: 16384 });
        raw = repaired.response;
        outputObj = tryParseJsonStrict(raw);
      } catch (e) {
        throw new Error(`Failed to repair JSON: ${e.message}`);
      }
    } else {
      throw new Error(`Failed to produce schema-valid JSON after 3 attempts. Errors: ${shape.errors.slice(0, 3).join(" | ")}`);
    }
  }

  return outputObj;
}
