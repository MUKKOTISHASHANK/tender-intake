#!/usr/bin/env node

/**
 * Tender Keyword Extraction Tool
 * Uses GPT-OSS model with recursive self-refinement to extract keywords from tender documents
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import mammoth from "mammoth";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

// Ollama Configuration
const OLLAMA_URL = "http://ollama-sales.mobiusdtaas.ai/api";
const OLLAMA_MODEL = "gpt-oss:120b";

// Load category mapping
const CATEGORY_FILE = path.join(__dirname, "catogery.json");

function loadCategories() {
  try {
    const data = fs.readFileSync(CATEGORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading categories from ${CATEGORY_FILE}:`, error.message);
    return [];
  }
}

// Extract department from document text
function extractDepartment(text) {
  const deptPatterns = [
    /Name\s+of\s+the\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})/i,
    /Organization[:\s]*[\r\n]+([^\r\n]{5,150})/i,
    /Issuing\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})/i,
    /Department[:\s]*[\r\n]+([^\r\n]{5,150})/i,
    /Public\s+Services\s+Department/i,
  ];

  // Try explicit patterns first
  for (const pattern of deptPatterns) {
    const match = text.match(pattern);
    if (match) {
      const dept = (match[1] || match[0]).trim();
      if (dept.length >= 5 && dept.length <= 150) {
        return dept;
      }
    }
  }

  // Check for PSD
  if (/Public\s+Services\s+Department/i.test(text)) {
    return "Public Services Department";
  }

  // Try to match against known departments from catogery.json
  const categories = loadCategories();
  const textLower = text.toLowerCase();
  
  for (const entry of categories) {
    const deptName = entry.department.toLowerCase();
    // Check if department name appears in text
    if (textLower.includes(deptName)) {
      return entry.department;
    }
    
    // Also check for partial matches (e.g., "Waste Management" matches "Waste")
    const deptWords = deptName.split(/\s+/);
    if (deptWords.length > 1) {
      const mainWords = deptWords.filter(w => w.length > 3);
      if (mainWords.every(word => textLower.includes(word))) {
        return entry.department;
      }
    }
  }

  return null;
}

// Find categories for a department
function findCategoriesForDepartment(department, categories) {
  if (!department) return null;
  
  // Exact match
  const exactMatch = categories.find(
    entry => entry.department.toLowerCase() === department.toLowerCase()
  );
  if (exactMatch) {
    return exactMatch.categories;
  }

  // Partial match
  const partialMatch = categories.find(entry => {
    const entryDept = entry.department.toLowerCase();
    const searchDept = department.toLowerCase();
    return entryDept.includes(searchDept) || searchDept.includes(entryDept);
  });
  
  if (partialMatch) {
    return partialMatch.categories;
  }

  return null;
}

// Document reading functions
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
      throw new Error("PDF file appears to be empty or could not extract text.");
    }
    
    return text
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }
}

async function readDocumentText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === ".pdf") {
    return await readPdfText(filePath);
  } else if (ext === ".docx" || ext === ".doc") {
    return await readDocxText(filePath);
  } else if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf-8");
  } else {
    throw new Error(`Unsupported file format: ${ext}. Supported: .pdf, .docx, .doc, .txt`);
  }
}

// Ollama API call
async function callOllama(prompt, maxRetries = 3) {
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
        throw new Error(`Ollama API call failed after ${maxRetries} attempts: ${error.message}`);
      }
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  return null;
}

// Build the recursive refinement prompt
function buildKeywordExtractionPrompt(category, tenderText) {
  return `You are a senior procurement analyst, tender evaluation expert, and NLP specialist.

Your task is to extract a COMPLETE, HIGH-QUALITY keyword set from a tender document using recursive self-refinement.

=================================================
INPUTS
=================================================
Tender Category: ${category}
Tender Document Text:
${tenderText.substring(0, 15000)}${tenderText.length > 15000 ? "\n[... document truncated for processing ...]" : ""}

=================================================
TASK OVERVIEW
=================================================
Follow the steps below STRICTLY in order. Do not skip any step.

-------------------------------------------------
STEP 1 — INITIAL EXTRACTION (MAXIMUM RECALL)
-------------------------------------------------
1. Extract ALL possible keywords and key phrases directly from the tender text.
2. Include:
   - Technical and domain-specific terms
   - Materials, equipment, tools, and technologies
   - Services, activities, and processes
   - Commercial and financial terms
   - Legal, regulatory, and compliance terminology
   - Operational, delivery, and execution terms
3. Preserve original wording.
4. Do NOT deduplicate, normalize, or filter.

-------------------------------------------------
STEP 2 — GAP ANALYSIS (EXPERT REVIEW)
-------------------------------------------------
As a domain expert:
1. Identify missing or implied keywords not explicitly stated but clearly relevant.
2. Add:
   - Industry-standard synonyms
   - Common abbreviations and acronyms
   - Mandatory regulatory or compliance terms expected for this category
   - Category-specific technical concepts commonly used in tenders
3. Briefly explain what was missing and why.

-------------------------------------------------
STEP 3 — SELF-REFINEMENT & NORMALIZATION
-------------------------------------------------
Improve the keyword list by:
1. Merging Step 1 and Step 2 results
2. Removing duplicates
3. Normalizing casing and phrasing
4. Grouping keywords into the following buckets:
   - Technical
   - Commercial
   - Legal & Compliance
   - Operational
   - Category-Specific

-------------------------------------------------
STEP 4 — VALIDATION & QUALITY CHECK
-------------------------------------------------
Validate the final keyword set against best practices for tender documents in the given category.

1. Remove irrelevant or weak keywords
2. Ensure strong category coverage
3. Score completeness from 0 to 100
4. Suggest any final additions if needed

=================================================
FINAL OUTPUT FORMAT (JSON ONLY)
=================================================
{
  "category": "${category}",
  "keywords": {
    "technical": [ ... ],
    "commercial": [ ... ],
    "legal_compliance": [ ... ],
    "operational": [ ... ],
    "category_specific": [ ... ]
  },
  "quality_check": {
    "completeness_score": number,
    "final_additions": [ ... ]
  }
}

IMPORTANT:
* Output ONLY valid JSON
* No explanations outside JSON
* Ensure maximum keyword coverage with high relevance`;
}

// Extract keywords with recursive refinement
async function extractKeywords(category, tenderText, refinementRounds = 2) {
  console.log(`\nExtracting keywords for category: ${category}`);
  console.log(`Document length: ${tenderText.length} characters`);
  console.log(`Refinement rounds: ${refinementRounds}\n`);

  let currentResult = null;
  let previousKeywords = null;

  for (let round = 1; round <= refinementRounds; round++) {
    console.log(`\n--- Round ${round}/${refinementRounds} ---`);
    
    let prompt;
    if (round === 1) {
      // First round: initial extraction
      prompt = buildKeywordExtractionPrompt(category, tenderText);
    } else {
      // Subsequent rounds: refinement based on previous result
      prompt = `You are a senior procurement analyst refining keyword extraction.

Previous extraction result:
${JSON.stringify(currentResult, null, 2)}

Tender Category: ${category}
Tender Document Text (sample):
${tenderText.substring(0, 5000)}${tenderText.length > 5000 ? "\n[...]" : ""}

TASK: Refine and improve the keyword extraction by:
1. Adding any missing relevant keywords
2. Removing weak or irrelevant keywords
3. Improving categorization
4. Increasing completeness score if possible
5. Ensuring all keywords are highly relevant to the tender document

Return ONLY valid JSON in the same format:
{
  "category": "${category}",
  "keywords": {
    "technical": [ ... ],
    "commercial": [ ... ],
    "legal_compliance": [ ... ],
    "operational": [ ... ],
    "category_specific": [ ... ]
  },
  "quality_check": {
    "completeness_score": number,
    "final_additions": [ ... ]
  }
}`;
    }

    try {
      console.log(`Calling Ollama API (round ${round})...`);
      const response = await callOllama(prompt);
      
      if (!response) {
        throw new Error("Empty response from Ollama API");
      }

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate structure
      if (!parsed.keywords || !parsed.quality_check) {
        throw new Error("Invalid JSON structure in response");
      }

      currentResult = parsed;
      
      // Count keywords
      const totalKeywords = Object.values(parsed.keywords || {})
        .flat()
        .length;
      
      console.log(`✓ Round ${round} complete: ${totalKeywords} keywords extracted`);
      console.log(`  Completeness score: ${parsed.quality_check?.completeness_score || "N/A"}`);

      // Check if we should continue refining
      if (round < refinementRounds) {
        // Compare with previous round
        if (previousKeywords) {
          const prevCount = Object.values(previousKeywords.keywords || {})
            .flat()
            .length;
          const improvement = totalKeywords - prevCount;
          console.log(`  Improvement: ${improvement > 0 ? '+' : ''}${improvement} keywords`);
        }
        previousKeywords = currentResult;
      }

    } catch (error) {
      console.error(`Error in round ${round}:`, error.message);
      if (round === 1) {
        throw error; // Fail if first round fails
      }
      // Use previous result if refinement fails
      console.log(`Using result from previous round...`);
      break;
    }
  }

  return currentResult;
}

// Main function
async function main() {
  const program = new Command();
  program
    .name("keyword-extractor")
    .description("Extract keywords from tender documents using AI")
    .requiredOption("--input <file>", "Path to tender document (.pdf, .docx, .txt)")
    .option("--category <category>", "Tender category (CONSULTANCY, SERVICES, SUPPLIES, WORKS). Auto-detected if not provided.")
    .option("--department <department>", "Department name. Auto-detected from document if not provided.")
    .option("--output <file>", "Output JSON file path (default: keywords-<category>.json)")
    .option("--rounds <number>", "Number of refinement rounds", "2")
    .parse(process.argv);

  const opts = program.opts();

  // Load categories from JSON file
  const categoryData = loadCategories();
  if (categoryData.length === 0) {
    console.error("Error: Could not load categories from catogery.json");
    process.exit(1);
  }

  // Read tender document
  console.log(`Reading document: ${opts.input}`);
  let tenderText;
  try {
    if (fs.existsSync(opts.input)) {
      tenderText = await readDocumentText(opts.input);
    } else {
      // Assume it's raw text if file doesn't exist
      tenderText = opts.input;
    }
  } catch (error) {
    console.error(`Error reading document: ${error.message}`);
    process.exit(1);
  }

  if (!tenderText || tenderText.trim().length === 0) {
    console.error("Error: Document is empty or could not extract text");
    process.exit(1);
  }

  // Extract or use provided department
  let department = opts.department;
  if (!department) {
    console.log("Extracting department from document...");
    department = extractDepartment(tenderText);
    if (department) {
      console.log(`✓ Detected department: ${department}`);
    } else {
      console.log("⚠ Could not detect department from document");
    }
  } else {
    console.log(`Using provided department: ${department}`);
  }

  // Find available categories for the department
  let availableCategories = null;
  if (department) {
    availableCategories = findCategoriesForDepartment(department, categoryData);
    if (availableCategories) {
      console.log(`✓ Available categories for ${department}: ${availableCategories.join(", ")}`);
    } else {
      console.log(`⚠ No matching department found in catogery.json. Using all categories.`);
      // If no match, allow any category
      availableCategories = ["CONSULTANCY", "SERVICES", "SUPPLIES", "WORKS"];
    }
  } else {
    // If no department found, allow any category
    availableCategories = ["CONSULTANCY", "SERVICES", "SUPPLIES", "WORKS"];
  }

  // Determine category
  let category = opts.category ? opts.category.toUpperCase() : null;
  
  if (!category) {
    // Auto-select if only one category available
    if (availableCategories && availableCategories.length === 1) {
      category = availableCategories[0];
      console.log(`✓ Auto-selected category: ${category}`);
    } else if (availableCategories && availableCategories.length > 1) {
      // Multiple categories available - use the first one or prompt user
      category = availableCategories[0];
      console.log(`⚠ Multiple categories available. Using first: ${category}`);
      console.log(`   Available: ${availableCategories.join(", ")}`);
      console.log(`   Use --category to specify a different one.`);
    } else {
      // Default to SERVICES if nothing found
      category = "SERVICES";
      console.log(`⚠ No category specified. Defaulting to: ${category}`);
    }
  } else {
    // Validate provided category
    const validCategories = ["CONSULTANCY", "SERVICES", "SUPPLIES", "WORKS"];
    if (!validCategories.includes(category)) {
      console.error(`Error: Invalid category. Must be one of: ${validCategories.join(", ")}`);
      process.exit(1);
    }
    
    // Check if category is available for the department
    if (availableCategories && !availableCategories.includes(category)) {
      console.warn(`⚠ Warning: Category ${category} may not be typical for department ${department || "unknown"}`);
      console.warn(`   Available categories: ${availableCategories.join(", ")}`);
    }
  }

  const refinementRounds = parseInt(opts.rounds) || 2;

  // Extract keywords
  try {
    const result = await extractKeywords(category, tenderText, refinementRounds);

    // Prepare output
    const output = {
      ...result,
      metadata: {
        source_file: opts.input,
        department: department || "Unknown",
        category: category,
        available_categories: availableCategories || [],
        extraction_date: new Date().toISOString(),
        document_length: tenderText.length,
        refinement_rounds: refinementRounds,
        model: OLLAMA_MODEL,
      }
    };

    // Write output
    const outputFile = opts.output || `keywords-${category.toLowerCase()}-${Date.now()}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
    
    console.log(`\n✓ Keywords extracted successfully!`);
    console.log(`  Output saved to: ${outputFile}`);
    console.log(`  Total keywords: ${Object.values(result.keywords || {}).flat().length}`);
    console.log(`  Completeness score: ${result.quality_check?.completeness_score || "N/A"}`);

  } catch (error) {
    console.error(`\nError extracting keywords: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

export { extractKeywords, buildKeywordExtractionPrompt, loadCategories };
