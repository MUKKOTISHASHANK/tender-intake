#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const NI = "Not identifiable from the document.";

// Ollama Configuration
const OLLAMA_URL = "http://ollama-sales.mobiusdtaas.ai/api";
const OLLAMA_MODEL = "gpt-oss:120b";
let OLLAMA_ENABLED = true; // Can be overridden by environment variable

const GAP_CATEGORIES = [
  "Administrative",
  "Technical",
  "Financial",
  "Support/SLA",
  "Compliance",
  "Governance",
  "Risk Management",
  "Integration",
  "KPI & Performance",
];

// Excel file path
const KEYWORDS_EXCEL_FILE = path.join(__dirname, "Tender_Keywords_56_Rows_FULL.xlsx");

// Initialize Express app
const app = express();
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Preserve original extension
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `file-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".docx", ".doc"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${ext}. Supported formats: .pdf, .docx, .doc`));
    }
  },
});

function initCategories() {
  return Object.fromEntries(GAP_CATEGORIES.map((k) => [k, []]));
}

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function rxFind(text, pattern, flags = "i") {
  const re = new RegExp(pattern, flags);
  const m = text.match(re);
  if (!m) return null;
  return m[1] ?? m[0];
}

async function readDocxText(docxPath) {
  const result = await mammoth.extractRawText({ path: docxPath });
  return (result.value || "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n");
}

async function readPdfText(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text || "";
    
    if (!text || text.trim().length === 0) {
      throw new Error("PDF file appears to be empty or could not extract text. The PDF might be image-based or encrypted.");
    }
    
    return text
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    if (error.message.includes("empty") || error.message.includes("encrypted")) {
      throw error;
    }
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }
}

async function readDocumentText(filePath, originalFileName = null) {
  // Get extension from original filename if provided, otherwise from filePath
  let ext = "";
  if (originalFileName) {
    ext = path.extname(originalFileName).toLowerCase();
  } else {
    ext = path.extname(filePath).toLowerCase();
  }
  
  // If still no extension, try to detect from file content or use original filename
  if (!ext && originalFileName) {
    ext = path.extname(originalFileName).toLowerCase();
  }
  
  try {
    if (ext === ".pdf") {
      return await readPdfText(filePath);
    } else if (ext === ".docx" || ext === ".doc") {
      return await readDocxText(filePath);
    } else {
      throw new Error(`Unsupported file format: ${ext || "unknown"}. Supported formats: .pdf, .docx, .doc`);
    }
  } catch (error) {
    if (error.message.includes("Unsupported")) {
      throw error;
    }
    throw new Error(`Error reading ${ext.toUpperCase() || "FILE"} file "${path.basename(originalFileName || filePath)}": ${error.message}`);
  }
}

/* -----------------------------
   Read Keywords from Excel
----------------------------- */

function loadKeywordsFromExcel() {
  try {
    if (!fs.existsSync(KEYWORDS_EXCEL_FILE)) {
      console.warn(`Warning: Keywords Excel file not found: ${KEYWORDS_EXCEL_FILE}`);
      return [];
    }

    const workbook = XLSX.readFile(KEYWORDS_EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (data.length === 0) {
      console.warn("Warning: Excel file is empty or has no data");
      return [];
    }

    // Assume first row is header
    const headers = data[0] || [];
    const keywords = [];

    // Find column indices for important fields
    const categoryIdx = headers.findIndex(h => 
      /category|gap.category|gap_category/i.test(String(h))
    );
    const keywordIdx = headers.findIndex(h => 
      /keyword|term|phrase|requirement/i.test(String(h))
    );
    const presenceIdx = headers.findIndex(h => 
      /presence|pattern|match/i.test(String(h))
    );
    const qualityIdx = headers.findIndex(h => 
      /quality|requires|detail/i.test(String(h))
    );
    const unclearIdx = headers.findIndex(h => 
      /unclear|ambiguous|trigger/i.test(String(h))
    );
    const outdatedIdx = headers.findIndex(h => 
      /outdated|legacy|old/i.test(String(h))
    );
    const requiredIdx = headers.findIndex(h => 
      /required|mandatory/i.test(String(h))
    );
    const whereIdx = headers.findIndex(h => 
      /where|section|location/i.test(String(h))
    );
    const nameIdx = headers.findIndex(h => 
      /name|rule|requirement/i.test(String(h))
    );

    // Process rows (skip header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const category = categoryIdx >= 0 ? String(row[categoryIdx] || "").trim() : "";
      const keyword = keywordIdx >= 0 ? String(row[keywordIdx] || "").trim() : "";
      const presence = presenceIdx >= 0 ? String(row[presenceIdx] || "").trim() : keyword;
      const quality = qualityIdx >= 0 ? String(row[qualityIdx] || "").trim() : "";
      const unclear = unclearIdx >= 0 ? String(row[unclearIdx] || "").trim() : "";
      const outdated = outdatedIdx >= 0 ? String(row[outdatedIdx] || "").trim() : "";
      const required = requiredIdx >= 0 ? String(row[requiredIdx] || "").trim().toLowerCase() : "false";
      const where = whereIdx >= 0 ? String(row[whereIdx] || "").trim() : "FULL";
      const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() : keyword || `Rule ${i}`;

      if (!category || !keyword) continue;

      // Parse arrays from comma-separated values
      const parseArray = (str) => {
        if (!str) return [];
        return str.split(",").map(s => s.trim()).filter(Boolean);
      };

      keywords.push({
        name: name,
        category: category,
        where: parseArray(where).length > 0 ? parseArray(where) : ["FULL"],
        presence: parseArray(presence).length > 0 ? parseArray(presence) : [keyword],
        quality_requires: parseArray(quality),
        unclear_triggers: parseArray(unclear),
        outdated_triggers: parseArray(outdated),
        required: required === "true" || required === "yes" || required === "1",
      });
    }

    console.log(`Loaded ${keywords.length} keyword rules from Excel file`);
    return keywords;
  } catch (error) {
    console.error(`Error loading keywords from Excel: ${error.message}`);
    return [];
  }
}

/* -----------------------------
   Ollama AI Integration
----------------------------- */

async function callOllama(prompt, maxRetries = 2) {
  if (!OLLAMA_ENABLED) {
    return null;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${OLLAMA_URL}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response?.trim() || null;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`Warning: Ollama API call failed after ${maxRetries} attempts: ${error.message}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function extractDocumentInfoWithAI(text) {
  if (!OLLAMA_ENABLED) return null;

  const prompt = `Extract the following information from this RFP/tender document. Return ONLY a JSON object with these exact keys: title, department, documentType, year, referenceId, version. If any field cannot be found, use null.

Document text (first 3000 characters):
${text.substring(0, 3000)}

Return only valid JSON, no explanations:
{
  "title": "...",
  "department": "...",
  "documentType": "RFP" or null,
  "year": 2024 or null,
  "referenceId": "..." or null,
  "version": "..." or null
}`;

  try {
    const response = await callOllama(prompt);
    if (!response) return null;

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || null,
        department: parsed.department || null,
        documentType: parsed.documentType || null,
        year: parsed.year || null,
        referenceId: parsed.referenceId || null,
        version: parsed.version || null,
      };
    }
  } catch (error) {
    console.error(`Warning: AI extraction failed: ${error.message}`);
  }
  return null;
}

async function enhanceRecommendationsWithAI(recommendations, gapCategories, documentInfo) {
  if (!OLLAMA_ENABLED) return recommendations;

  const categoriesWithRecs = Object.entries(recommendations)
    .filter(([_, recs]) => recs.length > 0);

  if (categoriesWithRecs.length === 0) return recommendations;

  const enhanced = { ...recommendations };

  for (const [category, recs] of categoriesWithRecs) {
    if (recs.length === 0) continue;

    const gaps = gapCategories[category] || [];
    if (gaps.length === 0) continue;

    const prompt = `You are an expert in government ICT tender analysis. Review and improve the following recommendations for a tender document.

Document: ${documentInfo.title || "RFP Document"}
Category: ${category}

Current Gaps:
${gaps.join("\n")}

Current Recommendations:
${recs.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Improve these recommendations to be:
- More specific and actionable
- Aligned with government procurement best practices
- Clear and professional

Return ONLY a JSON array with the same number of improved recommendations, no explanations:
["improved recommendation 1", "improved recommendation 2", ...]`;

    try {
      const response = await callOllama(prompt);
      if (response) {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const improved = JSON.parse(jsonMatch[0]);
          if (Array.isArray(improved) && improved.length === recs.length) {
            enhanced[category] = improved.filter(r => typeof r === 'string' && r.length > 0);
            continue;
          }
        }
      }
    } catch (error) {
      console.error(`Warning: AI enhancement failed for ${category}: ${error.message}`);
    }
  }

  return enhanced;
}

/* -----------------------------
   Document Info Extraction
----------------------------- */

function bestTitleCandidate(lines) {
  const titleSignals = /(rfp|request for proposal|sap|s4|s\/4|implementation|tender)/i;
  const clean = lines.map((x) => norm(x)).filter(Boolean);

  const strong = clean.find((x) => titleSignals.test(x) && x.length >= 15);
  if (strong) return strong;

  return clean.find((x) => x.length >= 10) || null;
}

function extractYear(text) {
  const extractYearFromMatch = (match) => {
    if (!match) return null;
    if (typeof match === 'string' && /^20\d{2}$/.test(match.trim())) {
      const year = parseInt(match.trim(), 10);
      if (year >= 2000 && year <= 2099) return year;
    }
    const yearMatch = typeof match === 'string' ? match.match(/(20\d{2})/) : null;
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (year >= 2000 && year <= 2099) return year;
    }
    return null;
  };

  const patterns = [
    String.raw`Date\s+of\s+issue[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Issue\s+Date[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Issued\s+on[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Date[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Reference\s+ID[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`Ref[.\s]+ID[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`RFP[.\s]+No[.\s]*[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`Reference\s+Number[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`(20\d{2})\s*(?:RFP|Request|Proposal)`,
    String.raw`(?:RFP|Request|Proposal)\s*(20\d{2})`,
    String.raw`(?:issue|issued|issue\s+date|date\s+of\s+issue)[^\n]{0,100}?(20\d{2})`,
    String.raw`(20\d{2})[^\n]{0,50}?(?:issue|issued|date)`,
  ];

  for (const pattern of patterns) {
    const match = rxFind(text, pattern, "i");
    const year = extractYearFromMatch(match);
    if (year) return year;
  }

  const earlyYear = rxFind(text, String.raw`^[\s\S]{0,1000}?(20\d{2})`, "i");
  const year = extractYearFromMatch(earlyYear);
  if (year) return year;

  return null;
}

async function extractDocumentInfo(text, providedDepartment = null) {
  let aiInfo = null;
  if (OLLAMA_ENABLED) {
    aiInfo = await extractDocumentInfoWithAI(text);
  }

  let title = null;
  const titlePatterns = [
    String.raw`Document\s+Title[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`Title[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`Request\s+for\s+Proposal[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`RFP[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`^([A-Z][^\r\n]{20,150}(?:SAP|S4|S\/4|Implementation|RFP|Tender)[^\r\n]{0,100})`,
  ];

  for (const pattern of titlePatterns) {
    const match = rxFind(text, pattern, "im");
    if (match) {
      const candidate = bestTitleCandidate([match]);
      if (candidate && candidate.length >= 15) {
        title = candidate;
        break;
      }
    }
  }

  if (!title) {
    const firstLines = text.split("\n").slice(0, 10).map(norm).filter(l => l.length >= 15);
    title = bestTitleCandidate(firstLines);
  }

  let department = providedDepartment || null;
  if (!department) {
    const deptPatterns = [
      String.raw`Name\s+of\s+the\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Issuing\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Department[:\s]*[\r\n]+([^\r\n]{5,150})`,
    ];

    for (const pattern of deptPatterns) {
      const match = rxFind(text, pattern, "i");
      if (match) {
        const cleaned = norm(match);
        if (cleaned.length >= 5 && cleaned.length <= 150) {
          department = cleaned;
          break;
        }
      }
    }

    if (/Public\s+Services\s+Department/i.test(text)) {
      department = "Public Services Department";
    } else if (!department && /PSD/i.test(text)) {
      department = "Public Services Department";
    }
  }

  let docType = /\bRFP\b|Request\s+for\s+Proposal/i.test(text) ? "RFP" : NI;

  let refId = null;
  const refIdPatterns = [
    String.raw`Reference\s+ID[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Ref[.\s]+ID[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`RFP[.\s]+No[.\s]*[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Reference\s+Number[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Document\s+Reference[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
  ];

  for (const pattern of refIdPatterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      refId = norm(match);
      if (refId.length >= 3) break;
    }
  }

  let version = null;
  const versionPatterns = [
    String.raw`Version\s+No[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`Version[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`Ver[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`V[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
  ];

  for (const pattern of versionPatterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      version = norm(match);
      if (version.length >= 1) break;
    }
  }

  const notes = [];
  if (refId) notes.push(`Reference ID: ${refId}`);
  if (version) notes.push(`Version: ${version}`);

  const year = extractYear(text);

  if (aiInfo) {
    if (!title || title === NI) {
      title = aiInfo.title;
    } else if (aiInfo.title && aiInfo.title !== title && aiInfo.title.length > title.length) {
      title = aiInfo.title;
    }

    if (!department || department === NI) {
      department = aiInfo.department;
    } else if (aiInfo.department && aiInfo.department.length > department.length) {
      department = aiInfo.department;
    }

    if (docType === NI && aiInfo.documentType) {
      docType = aiInfo.documentType;
    }

    if ((year === null || year === NI) && aiInfo.year) {
      year = aiInfo.year;
    }

    if (!refId && aiInfo.referenceId) {
      refId = aiInfo.referenceId;
      if (!notes.some(n => n.includes("Reference ID"))) {
        notes.push(`Reference ID: ${refId}`);
      }
    }

    if (!version && aiInfo.version) {
      version = aiInfo.version;
      if (!notes.some(n => n.includes("Version"))) {
        notes.push(`Version: ${version}`);
      }
    }
  }

  return {
    title: title ? norm(title) : NI,
    department: department ? norm(department) : NI,
    documentType: docType,
    year: year ?? NI,
    notes: notes.length ? notes.join("; ") : NI,
  };
}

/* -----------------------------
   Section slicing
----------------------------- */

const SECTION_HEADERS = [
  "Introduction",
  "Instructions to Vendor",
  "Proposal Guidelines",
  "Selection Process",
  "Award of Contract",
  "Termination of Contract",
  "Scope of Work",
  "Rules, Assumptions",
  "System Landscape",
  "Integration",
  "Go-Live and Post-Implementation Support",
];

function splitIntoSections(text) {
  const headerRegex = new RegExp(
    `^(${SECTION_HEADERS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*$`,
    "gmi"
  );

  const matches = [...text.matchAll(headerRegex)];
  if (!matches.length) return { FULL: text };

  const sections = {};
  for (let i = 0; i < matches.length; i++) {
    const name = norm(matches[i][1]);
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    sections[name] = text.slice(start, end).trim();
  }
  sections.FULL = text;
  return sections;
}

function inText(text, patterns) {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

function missingTerms(text, requiredPatterns) {
  return requiredPatterns.filter((p) => !new RegExp(p, "i").test(text));
}

/* -----------------------------
   Build Rules from Excel Keywords
----------------------------- */

function buildRulesFromKeywords(keywords) {
  if (!keywords || keywords.length === 0) {
    console.warn("No keywords loaded from Excel, using default rules");
    return buildDefaultRules();
  }
  return keywords;
}

function buildDefaultRules() {
  // Fallback default rules if Excel is empty
  return [
    {
      name: "Submission guidelines and proposal instructions",
      category: "Administrative",
      where: ["Proposal Guidelines", "Instructions to Vendor", "FULL"],
      presence: [
        String.raw`Deadline for Submission`,
        String.raw`Last date for Submission`,
        String.raw`Send the proposal`,
        String.raw`submission of proposals`,
      ],
      quality_requires: [String.raw`format`, String.raw`deadline`, String.raw`email`],
      unclear_triggers: [String.raw`may.*extend`, String.raw`sole discretion`],
      outdated_triggers: [],
      required: true,
    },
  ];
}

/* -----------------------------
   Analysis
----------------------------- */

async function analyze(filePath, providedDepartment = null, providedCategory = null, originalFileName = null) {
  const text = await readDocumentText(filePath, originalFileName);
  const sections = splitIntoSections(text);

  const documentInfo = await extractDocumentInfo(text, providedDepartment);
  
  // Override department if provided
  if (providedDepartment) {
    documentInfo.department = providedDepartment;
  }

  const gapCategories = initCategories();
  const recommendations = initCategories();

  const missingSections = [];
  const weakSections = [];
  const unclearSections = [];
  const outdatedContent = [];

  // Load keywords from Excel
  const keywords = loadKeywordsFromExcel();
  const rules = buildRulesFromKeywords(keywords);

  // Filter rules by category if provided
  let filteredRules = rules;
  if (providedCategory) {
    filteredRules = rules.filter(r => 
      r.category.toLowerCase() === providedCategory.toLowerCase()
    );
    if (filteredRules.length === 0) {
      console.warn(`No rules found for category: ${providedCategory}, using all rules`);
      filteredRules = rules;
    }
  }

  function getScopeText(rule) {
    const chunks = [];
    for (const sec of rule.where) {
      if (sections[sec]) chunks.push(sections[sec]);
    }
    return chunks.length ? chunks.join("\n") : sections.FULL;
  }

  for (const r of filteredRules) {
    const scope = getScopeText(r);
    const present = inText(scope, r.presence);

    if (r.required && !present) {
      missingSections.push(r.name);
      gapCategories[r.category].push(`Missing: ${r.name}`);
      recommendations[r.category].push(
        `Add a complete section for '${r.name}' aligned to PSD/government tender norms.`
      );
      continue;
    }

    if (present) {
      if (r.quality_requires?.length) {
        const miss = missingTerms(scope, r.quality_requires);
        if (miss.length) {
          weakSections.push(`${r.name} lacks detail: ${miss.join(", ")}`);
          gapCategories[r.category].push(
            `Weak: ${r.name} lacks measurable detail (${miss.join(", ")}).`
          );
          recommendations[r.category].push(
            `Strengthen '${r.name}' by explicitly defining: ${miss.join(", ")}.`
          );
        }
      }

      if (r.unclear_triggers?.length && inText(scope, r.unclear_triggers)) {
        const hits = r.unclear_triggers.filter((p) => new RegExp(p, "i").test(scope));
        unclearSections.push(`${r.name} contains ambiguous phrasing (${hits.join(", ")})`);
        gapCategories[r.category].push(
          `Unclear: ${r.name} contains ambiguous phrasing (${hits.join(", ")}).`
        );
        recommendations[r.category].push(
          `Clarify '${r.name}' by replacing ambiguous phrases with specific, testable requirements.`
        );
      }

      if (r.outdated_triggers?.length) {
        for (const p of r.outdated_triggers) {
          if (new RegExp(p, "i").test(scope)) {
            const msg = `Outdated reference in '${r.name}': ${p}`;
            if (!outdatedContent.includes(msg)) outdatedContent.push(msg);
            gapCategories[r.category].push(`Outdated: ${msg}`);
            recommendations[r.category].push(
              `Update '${r.name}' to remove legacy references and align to current government enterprise standards.`
            );
          }
        }
      }
    }
  }

  // Extra deterministic checks
  const headerDeadline = rxFind(
    text,
    String.raw`Proposal Submission Deadline\s*[\r\n]+?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})`
  );
  const tableDeadline = rxFind(
    text,
    String.raw`Submission of Technical and Commercial Proposal\s*[\r\n]+?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})`
  );
  if (headerDeadline && tableDeadline && headerDeadline !== tableDeadline) {
    unclearSections.push(`Contradictory proposal submission deadlines: ${headerDeadline} vs ${tableDeadline}`);
    gapCategories["Administrative"].push(
      `Unclear: Contradictory proposal submission deadlines (${headerDeadline} vs ${tableDeadline}).`
    );
    recommendations["Administrative"].push(
      "Resolve conflicting submission deadlines by issuing an addendum that states one authoritative deadline (date + time + timezone)."
    );
  }

  if (!/\bKPI\b|Key Performance|scorecard|OKR/i.test(text)) {
    missingSections.push("Specific metrics for evaluating vendor performance post-implementation");
    gapCategories["KPI & Performance"].push(
      "Missing: Specific metrics for evaluating vendor performance post-implementation."
    );
    recommendations["KPI & Performance"].push(
      "Add a KPI/benefits-realization section covering baseline, targets, measurement cadence, and vendor accountability post go-live."
    );
  }

  if (/risk/i.test(text) && !/risk scoring|risk register|probability|impact/i.test(text)) {
    weakSections.push("Risk management is mentioned but lacks formal scoring/register (probability × impact).");
    gapCategories["Risk Management"].push(
      "Weak: Risk management is mentioned but lacks a formal risk scoring model and risk register."
    );
    recommendations["Risk Management"].push(
      "Add a formal risk register with probability/impact scoring, mitigation owners, review cadence, and escalation thresholds."
    );
  }

  function computeScore() {
    if (missingSections.length) return 32;
    if (outdatedContent.length) return 52;
    if (unclearSections.length) return 62;
    if (weakSections.length) return 72;
    return 90;
  }

  const overallScore = computeScore();
  const summary =
    (missingSections.length || weakSections.length || unclearSections.length || outdatedContent.length)
      ? "The document contains gaps and/or weaknesses against typical government ICT transformation tender standards, notably around KPI/performance accountability, clarity of administrative dates, and modernization of legacy references."
      : "The document appears broadly complete against common government ICT tender best practices.";

  const high = [];
  const med = [];
  const low = [];

  if ([...unclearSections, ...missingSections].some((x) => /integration/i.test(x))) {
    high.push("Unclear integration requirements could lead to project failure and vendor misalignment.");
  }
  if ([...weakSections, ...missingSections].some((x) => /SLA|Support/i.test(x))) {
    high.push("Weak SLA/support definition may cause low performance and uncontrolled operational costs.");
  }
  if ([...weakSections, ...missingSections].some((x) => /security/i.test(x))) {
    high.push("Insufficient security requirements increase cybersecurity and compliance risk.");
  }

  if (unclearSections.some((x) => /Contradictory/i.test(x))) {
    med.push("Administrative contradictions (submission deadlines) may cause procurement disputes or unfairness claims.");
  }
  if ([...weakSections, ...missingSections].some((x) => /Risk management/i.test(x))) {
    med.push("Weak risk governance can reduce delivery predictability and oversight quality.");
  }
  if (missingSections.length) {
    med.push("Missing standard tender modules can lead to inconsistent vendor proposals and evaluation difficulty.");
  }

  if (outdatedContent.length) {
    low.push("Legacy technology references may misalign solution assumptions with current enterprise baselines.");
  }

  const finalize = (arr) => (arr.length ? arr : [NI]);

  let enhancedRecommendations = recommendations;
  if (OLLAMA_ENABLED && Object.values(recommendations).some(recs => recs.length > 0)) {
    console.log("Enhancing recommendations with AI validation...");
    enhancedRecommendations = await enhanceRecommendationsWithAI(recommendations, gapCategories, documentInfo);
  }

  return {
    documentInfo: documentInfo,
    completenessAssessment: {
      overallScore,
      summary,
      missingSections: missingSections.length ? missingSections : [NI],
      weakSections: weakSections.length ? weakSections : [NI],
      unclearSections: unclearSections.length ? unclearSections : [NI],
      outdatedContent: outdatedContent.length ? outdatedContent : [NI],
    },
    gapCategories: gapCategories,
    criticalRisks: {
      highImpactRisks: finalize(high),
      mediumImpactRisks: finalize(med),
      lowImpactRisks: finalize(low),
    },
    recommendations: enhancedRecommendations,
  };
}

/* -----------------------------
   API Endpoints
----------------------------- */

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Tender Gap Analyzer API is running" });
});

// Main analysis endpoint
app.post("/analyze", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Please provide a 'document' file." });
    }

    const { department, category } = req.body;

    console.log(`Processing file: ${req.file.originalname}`);
    console.log(`Department: ${department || "auto-detect"}`);
    console.log(`Category: ${category || "all"}`);

    const result = await analyze(req.file.path, department || null, category || null, req.file.originalname);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      filename: req.file.originalname,
      result: result,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Analysis error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "An error occurred during analysis",
    });
  }
});

// Get available categories from Excel
app.get("/categories", (req, res) => {
  try {
    const keywords = loadKeywordsFromExcel();
    const categories = [...new Set(keywords.map(k => k.category))].sort();
    res.json({
      success: true,
      categories: categories,
      totalRules: keywords.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get keywords/rules for a specific category
app.get("/keywords/:category", (req, res) => {
  try {
    const { category } = req.params;
    const keywords = loadKeywordsFromExcel();
    const filtered = keywords.filter(k => 
      k.category.toLowerCase() === category.toLowerCase()
    );
    res.json({
      success: true,
      category: category,
      keywords: filtered,
      count: filtered.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 50MB." });
    }
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message || "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Tender Gap Analyzer API Server`);
  console.log(`   Listening on http://${HOST}:${PORT}`);
  console.log(`   Health check: http://${HOST}:${PORT}/health`);
  console.log(`   Analyze endpoint: POST http://${HOST}:${PORT}/analyze`);
  console.log(`   Categories endpoint: GET http://${HOST}:${PORT}/categories`);
  console.log(`   Keywords endpoint: GET http://${HOST}:${PORT}/keywords/:category`);
  console.log(`\n📊 Loading keywords from: ${KEYWORDS_EXCEL_FILE}`);
  
  // Pre-load keywords to verify Excel file
  const keywords = loadKeywordsFromExcel();
  if (keywords.length > 0) {
    console.log(`   ✓ Loaded ${keywords.length} keyword rules`);
    const categories = [...new Set(keywords.map(k => k.category))];
    console.log(`   ✓ Categories: ${categories.join(", ")}`);
  } else {
    console.log(`   ⚠ Warning: No keywords loaded. Using default rules.`);
  }
  
  console.log(`\n✅ Server ready!\n`);
});

export default app;
