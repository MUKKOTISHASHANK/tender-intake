import path from "path";
import { readDocumentText } from "./documentService.js";
import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_ENABLED } from "../config/ollamaConfig.js";

// -------------------- CONFIG --------------------
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || OLLAMA_URL.replace(/\/api$/, "")).replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 300;

// -------------------- KEYWORD PATTERNS FOR FAST EXTRACTION --------------------
const COMPANY_NAME_PATTERNS = [
  /company\s+name/i,
  /vendor\s+name/i,
  /bidder\s+name/i,
  /proposer\s+name/i,
  /supplier\s+name/i,
  /contractor\s+name/i,
  /firm\s+name/i,
];

const RATING_PATTERNS = [
  /overall\s+rating/i,
  /final\s+rating/i,
  /total\s+score/i,
  /overall\s+score/i,
  /final\s+score/i,
  /total\s+rating/i,
  /evaluation\s+score/i,
];

const WEIGHTAGE_PATTERNS = [
  /weightage/i,
  /weight/i,
  /weighting/i,
  /percentage/i,
  /\%/i,
];

const SUBCATEGORY_PATTERNS = [
  /module\s+covered/i,
  /data\s+migration/i,
  /organizational\s+change\s+management/i,
  /post\s+implementation\s+support/i,
  /custom\s+objects\s+considered/i,
  /ricef/i,
  /project\s+duration/i,
  /implementation\s+timeline/i,
  /consultants/i,
  /partner\s+experience/i,
  /reference/i,
  /gcc\s+region/i,
  /non-gcc\s+region/i,
  /public\s+service\s+domain/i,
];

// -------------------- UTILS --------------------
function normalizeWhitespace(text) {
  return (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    chunks.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function safeJsonParse(str) {
  if (!str || typeof str !== "string") {
    throw new Error("Input is not a string.");
  }

  const trimmed = str.trim();
  
  // Handle empty or invalid responses
  if (trimmed === "{}" || trimmed === "null" || trimmed === "") {
    throw new Error("AI returned empty object or null. Model may not have found data or prompt was unclear.");
  }

  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If we got an object instead of array, try to convert it
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      console.warn("⚠️  AI returned object instead of array, attempting to convert...");
      // If it's a single company object, wrap it in array
      if (parsed["Company Name"]) {
        return [parsed];
      }
      // If it has a companies key, use that
      if (Array.isArray(parsed.companies)) {
        return parsed.companies;
      }
      // If it has a data key with array
      if (Array.isArray(parsed.data)) {
        return parsed.data;
      }
      throw new Error("AI returned an object instead of an array. Expected JSON array format.");
    }
  } catch {}

  // Remove markdown code blocks
  let cleaned = str.trim();
  
  // Remove ```json ... ``` blocks
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch {}
  }

  // Remove ``` ... ``` blocks (any language)
  cleaned = cleaned.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();

  // Try parsing cleaned version
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}

  // Extract JSON array using bracket matching
  let bracketCount = 0;
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "[") {
      if (startIdx === -1) startIdx = i;
      bracketCount++;
    } else if (cleaned[i] === "]") {
      bracketCount--;
      if (bracketCount === 0 && startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx >= 0 && endIdx > startIdx) {
    try {
      const jsonStr = cleaned.slice(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // Try with more aggressive cleaning
      const jsonStr = cleaned.slice(startIdx, endIdx + 1)
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
        .replace(/:(\s*)([^",\[\]{}]+)(\s*[,\]}])/g, ':$1"$2"$3');
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {}
    }
  }

  // Last resort: find any array-like structure
  const arrayMatch = cleaned.match(/\[[\s\S]{10,}\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }

  throw new Error(`Could not extract valid JSON array from response. First 500 chars: ${str.substring(0, 500)}`);
}

// -------------------- KEYWORD-BASED SECTION EXTRACTION --------------------
function findMatrixSection(text) {
  const lines = text.split("\n");
  const matrixLines = [];
  let inMatrix = false;
  let headerFound = false;
  let bestMatchStart = -1;
  let bestMatchEnd = -1;
  let bestMatchScore = 0;

  // First pass: Look for clear matrix headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    // Detect matrix start (look for company names or rating headers)
    if (!inMatrix) {
      const hasCompanyHeader = COMPANY_NAME_PATTERNS.some(p => p.test(line));
      const hasRatingHeader = RATING_PATTERNS.some(p => p.test(line));
      const hasWeightageHeader = WEIGHTAGE_PATTERNS.some(p => p.test(line));
      const hasSubcategory = SUBCATEGORY_PATTERNS.some(p => p.test(line));
      
      if (hasCompanyHeader || hasRatingHeader || hasWeightageHeader || hasSubcategory) {
        inMatrix = true;
        headerFound = true;
        // Include some lines before for context
        const startIdx = Math.max(0, i - 10);
        matrixLines.push(...lines.slice(startIdx, i));
      }
    }
    
    if (inMatrix) {
      matrixLines.push(lines[i]);
      
      // Stop if we hit a clear section break (empty lines + new heading)
      if (i < lines.length - 1) {
        const nextLine = lines[i + 1].toLowerCase();
        const isSectionBreak = (
          line.trim() === "" && 
          nextLine.length > 0 &&
          (nextLine.match(/^(chapter|section|appendix|table of contents)/i) ||
           nextLine.match(/^[0-9]+\./))
        );
        if (isSectionBreak && matrixLines.length > 50) {
          break;
        }
      }
    }
  }

  // Second pass: Look for table-like structures with multiple numbers (more flexible)
  if (matrixLines.length < 50) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const numbers = line.match(/\d+\.?\d*/g);
      const lowerLine = line.toLowerCase();
      
      // Score this line based on indicators
      let score = 0;
      if (numbers && numbers.length >= 3) score += 2;
      if (RATING_PATTERNS.some(p => p.test(lowerLine))) score += 3;
      if (WEIGHTAGE_PATTERNS.some(p => p.test(lowerLine))) score += 3;
      if (SUBCATEGORY_PATTERNS.some(p => p.test(lowerLine))) score += 2;
      if (COMPANY_NAME_PATTERNS.some(p => p.test(lowerLine))) score += 3;
      
      // Check for company names (uppercase words, common company patterns)
      const hasCompanyName = /^[A-Z]{3,}(?:\s+[A-Z]{2,})*/.test(line.trim()) && 
                             !/^(THE|AND|FOR|WITH|FROM|THIS|THAT)/.test(line.trim());
      if (hasCompanyName && numbers && numbers.length >= 2) score += 2;
      
      if (score >= 3) {
        const startIdx = Math.max(0, i - 15);
        const endIdx = Math.min(lines.length, i + 150); // Increased window
        const sectionSize = endIdx - startIdx;
        
        if (sectionSize > bestMatchScore) {
          bestMatchStart = startIdx;
          bestMatchEnd = endIdx;
          bestMatchScore = sectionSize;
        }
      }
    }
    
    if (bestMatchStart >= 0 && bestMatchEnd > bestMatchStart) {
      return lines.slice(bestMatchStart, bestMatchEnd).join("\n");
    }
  }

  // Third pass: If still nothing, look for sections with "evaluation", "matrix", "table", "rating"
  if (matrixLines.length < 50) {
    const evaluationKeywords = /evaluation|matrix|rating|score|weightage|assessment/i;
    for (let i = 0; i < lines.length; i++) {
      if (evaluationKeywords.test(lines[i])) {
        const startIdx = Math.max(0, i - 10);
        const endIdx = Math.min(lines.length, i + 200);
        const section = lines.slice(startIdx, endIdx).join("\n");
        // Check if this section has multiple numbers (likely a table)
        const numberCount = (section.match(/\d+\.?\d*/g) || []).length;
        if (numberCount >= 10) {
          return section;
        }
      }
    }
  }

  // Return found matrix or a larger chunk of text for AI to analyze
  if (matrixLines.length > 20) {
    return matrixLines.join("\n");
  }
  
  // Fallback: Return larger sections (middle and end of document where tables usually are)
  const midPoint = Math.floor(text.length / 2);
  const endPoint = text.length;
  const midSection = text.substring(Math.max(0, midPoint - 10000), midPoint + 10000);
  const endSection = text.substring(Math.max(0, endPoint - 20000));
  
  // Return the section with more numbers (likely contains tables)
  const midNumbers = (midSection.match(/\d+\.?\d*/g) || []).length;
  const endNumbers = (endSection.match(/\d+\.?\d*/g) || []).length;
  
  return midNumbers > endNumbers ? midSection : endSection;
}

function extractRelevantSections(text) {
  // Find the matrix section using keywords
  const matrixSection = findMatrixSection(text);
  
  // Also extract first 5000 chars (cover page, headers, company names) and last 10000 chars (tables, appendices, evaluation matrices)
  const introSection = text.substring(0, 5000);
  const endSection = text.substring(Math.max(0, text.length - 10000));
  const midSection = text.substring(Math.floor(text.length / 2) - 5000, Math.floor(text.length / 2) + 5000);
  
  // Combine sections - prioritize matrix section, but include context
  let combined = `${introSection}\n\n---MATRIX_SECTION---\n\n${matrixSection}\n\n---MID_SECTION---\n\n${midSection}\n\n---END_SECTION---\n\n${endSection}`;
  
  // Limit total size but be more generous (max 30000 chars for better extraction)
  if (combined.length > 30000) {
    // Prioritize matrix section
    const matrixLength = matrixSection.length;
    const remaining = 30000 - matrixLength - 2000; // Reserve space for separators
    const introPart = introSection.substring(0, Math.floor(remaining * 0.3));
    const midPart = midSection.substring(0, Math.floor(remaining * 0.3));
    const endPart = endSection.substring(0, Math.floor(remaining * 0.4));
    combined = `${introPart}\n\n---MATRIX_SECTION---\n\n${matrixSection}\n\n---MID_SECTION---\n\n${midPart}\n\n---END_SECTION---\n\n${endPart}`;
  }
  
  return combined;
}

// -------------------- OLLAMA API --------------------
async function ollamaChat({ model, messages, temperature = 0, maxRetries = 2 }) {
  if (!OLLAMA_ENABLED) {
    throw new Error("Ollama is not enabled");
  }

  const url = `${OLLAMA_BASE_URL}/api/chat`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const payload = {
        model,
        messages,
        stream: false,
        options: { temperature },
      };
      
      // NOTE: NOT using format: "json" as it causes Ollama to return {} instead of actual content
      // We'll extract JSON manually from the response text

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ollama chat error ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const content = data?.message?.content;

      if (typeof content !== "string") {
        console.error("❌ Invalid response structure:", JSON.stringify(data, null, 2).substring(0, 500));
        throw new Error(`Chat response missing message.content. Response structure: ${JSON.stringify(data).substring(0, 200)}`);
      }

      // Log if response is suspiciously short
      if (content.length < 10) {
        console.warn(`⚠️  Very short response received: "${content}"`);
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

// -------------------- OUTPUT SCHEMA --------------------
const OUTPUT_SCHEMA = `[
  {
    "Company Name": "string (exact company name from document)",
    "Overall Rating": "number or null (final score like 7.9, 8.8, 9.5)",
    "Category-Level Weightage": "number or null",
    "Category-Level Rating": "number or null",
    "Subcategory Ratings": {
      "Module Covered": { "Weightage": "number or null", "Rating": "number or null" },
      "Data Migration": { "Weightage": "number or null", "Rating": "number or null" },
      "Organizational change management": { "Weightage": "number or null", "Rating": "number or null" },
      "Post Implementation Support": { "Weightage": "number or null", "Rating": "number or null" },
      "Custom Objects Considered (RICEF)": { "Weightage": "number or null", "Rating": "number or null" },
      "Project Duration": { "Weightage": "number or null", "Rating": "number or null" },
      "Implementation Timeline / Consultants": { "Weightage": "number or null", "Rating": "number or null" },
      "Partner Experience": { "Weightage": "number or null", "Rating": "number or null" },
      "Reference (>1 Million Dollar) - Public Service Domain": { "Weightage": "number or null", "Rating": "number or null" },
      "Reference # 1 - GCC region": { "Weightage": "number or null", "Rating": "number or null" },
      "Reference # 1 - Non-GCC region": { "Weightage": "number or null", "Rating": "number or null" }
    }
  }
]`;

// -------------------- SYSTEM PROMPT --------------------
const SYSTEM_PROMPT = `You are a Tender Evaluation Matrix Extraction Agent. Extract company evaluation data from tender documents.

YOUR TASK:
1. Find ALL company names in the document (look in tables, headers, matrices, evaluation sections)
2. For EACH company, extract their ratings and weightages from the evaluation matrix/table
3. Return a JSON array with one object per company

HOW TO FIND COMPANIES:
- Look for table headers with company names (often in uppercase: EDRAKY, COGNIZANT, KAAR, etc.)
- Look for columns in tables/matrices - each column usually represents one company
- Company names might appear in: "Company Name" row, table headers, or column headers
- Search the entire document - companies might be mentioned multiple times

HOW TO EXTRACT DATA:
- Find rows labeled "Overall Rating", "Final Rating", "Total Score", or similar
- For each company column, extract the number in that row
- Find "Weightage" rows and extract weightage values for each company
- Find subcategory rows (Module Covered, Data Migration, etc.) and extract ratings/weightages
- Look for tables with multiple columns - each column = one company

REQUIRED OUTPUT FORMAT - MUST BE A JSON ARRAY:
${OUTPUT_SCHEMA}

EXTRACTION RULES:
1. Extract ALL companies found (do not skip any)
2. Use EXACT company names as they appear (case-sensitive)
3. Extract Overall Rating from rating rows (numbers like 7.9, 8.8, 9.5)
4. Extract Category-Level Weightage and Rating if present
5. Extract Subcategory Ratings with Weightage and Rating for each subcategory
6. Use null for missing values (never guess or invent)
7. Convert symbols: ✓/✔ = 10, ✖/X = 0, ●/○ = null
8. Numbers can be decimals (7.9, 8.8) or integers (10, 0.35)

TERMINOLOGY MAPPING (map similar terms to exact schema names):
- "Module Coverage" → "Module Covered"
- "Implementation Approach" → "Implementation Timeline / Consultants"
- "Partner Capability" → "Partner Experience"
- "References" → "Reference (>1 Million Dollar) - Public Service Domain"

CRITICAL OUTPUT REQUIREMENTS:
- Your response MUST be a JSON array starting with [ and ending with ]
- Return ONLY the JSON array, no markdown, no code blocks, no explanations
- Include ALL companies you find - one object per company
- If you find at least one company, return array with that data
- Only return empty array [] if absolutely no company data exists in the document
- DO NOT return an object {}, always return an array []`;

// -------------------- MAIN EXTRACTION FUNCTION --------------------
export async function extractTenderMatrix(filePath, tenderId = null, originalFileName = null) {
  console.log(`📄 Reading document: ${path.basename(filePath)}`);
  
  // Step 1: Read document text
  const fullText = await readDocumentText(filePath, originalFileName);
  const normalizedText = normalizeWhitespace(fullText);
  
  if (normalizedText.length < 50) {
    throw new Error("No readable text extracted from document.");
  }

  console.log(`✅ Document text length: ${normalizedText.length} characters`);

  // Step 2: Fast keyword-based section extraction
  console.log(`🔍 Extracting matrix section using keywords...`);
  const relevantSection = extractRelevantSections(normalizedText);
  console.log(`✅ Extracted section length: ${relevantSection.length} characters`);

  // Step 3: Use AI to extract structured data
  console.log(`🤖 Extracting structured matrix data...`);
  console.log(`📊 Relevant section preview (first 500 chars): ${relevantSection.substring(0, 500)}`);
  console.log(`📊 Relevant section preview (last 500 chars): ${relevantSection.substring(Math.max(0, relevantSection.length - 500))}`);
  
  const userPrompt = `Extract the evaluation matrix from this tender document. The document contains an evaluation matrix/table with company names, ratings, and weightages.

Tender ID: ${tenderId || "Not provided"}

DOCUMENT TEXT:
${relevantSection}

TASK - Extract ALL companies and their evaluation data:
1. Search for ALL company names in the document (look in headers, tables, matrices)
   - Common company names might be: EDRAKY, COGNIZANT, KAAR, TYCONZ, SOLTIUS, or others
   - Company names are usually in table headers or column headers
   - Look for uppercase words that appear in multiple places

2. For EACH company found, extract:
   - Company Name (exact spelling as it appears)
   - Overall Rating (look for "Overall Rating", "Final Rating", "Total Score" rows - extract the number for this company's column)
   - Category-Level Weightage (if present in a weightage row)
   - Category-Level Rating (if present in a rating row)
   - All Subcategory Ratings:
     * Module Covered
     * Data Migration
     * Organizational change management
     * Post Implementation Support
     * Custom Objects Considered (RICEF)
     * Project Duration
     * Implementation Timeline / Consultants
     * Partner Experience
     * Reference (>1 Million Dollar) - Public Service Domain
     * Reference # 1 - GCC region
     * Reference # 1 - Non-GCC region
     For each subcategory, extract Weightage and Rating from the corresponding rows

3. Return a JSON ARRAY with one object per company

IMPORTANT NOTES:
- Look for tables with multiple columns (one per company)
- Ratings are usually numbers (7.9, 8.8, 10, etc.)
- Weightages are usually decimals (0.35, 0.05, etc.)
- If a value is not found, use null
- Convert symbols: ✓ or ✔ = 10, ✖ or X = 0, ● or ○ = null
- Company names might be in different formats - extract exactly as shown

CRITICAL OUTPUT REQUIREMENTS: 
- Return ONLY a JSON array: [{"Company Name": "...", "Overall Rating": number, ...}, ...]
- Start with [ and end with ]
- Include ALL companies found in the document
- If you find at least one company, return the array with that company's data
- Only return empty array [] if absolutely no company data is found

Your response must be ONLY the JSON array, nothing else.`;

  let rawResponse;
  let result;
  let parseAttempts = 0;
  const maxParseAttempts = 2;

  while (parseAttempts < maxParseAttempts) {
    try {
      rawResponse = await ollamaChat({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
      });
      
      console.log(`📝 Raw AI response length: ${rawResponse.length} characters`);
      console.log(`📝 First 200 chars: ${rawResponse.substring(0, 200)}`);
      
      result = safeJsonParse(rawResponse);
      
      if (Array.isArray(result) && result.length > 0) {
        console.log(`✅ Successfully parsed JSON array with ${result.length} items`);
        break;
      } else if (Array.isArray(result) && result.length === 0) {
        console.warn("⚠️  Parsed empty array, retrying with more document content and explicit prompt...");
        parseAttempts++;
        if (parseAttempts < maxParseAttempts) {
          // Use more of the document and more explicit prompt
          const extendedSection = normalizedText.length > 50000 
            ? normalizedText.substring(Math.max(0, normalizedText.length - 50000)) // Last 50k chars
            : normalizedText;
          
          const retryPrompt = `Extract companies and ratings from this tender evaluation document. 

The document contains an evaluation matrix/table. Look carefully for:
- Table headers with company names (often uppercase words like EDRAKY, COGNIZANT, KAAR, TYCONZ, SOLTIUS)
- Rows with "Overall Rating", "Rating", "Weightage" labels
- Numbers in columns (each column = one company)

Document content:
${extendedSection.substring(0, 40000)}

Required output format - MUST be a JSON array:
[
  {
    "Company Name": "EXACT_COMPANY_NAME_FROM_DOCUMENT",
    "Overall Rating": 7.9,
    "Category-Level Weightage": null,
    "Category-Level Rating": 7.9,
    "Subcategory Ratings": {
      "Module Covered": {"Weightage": 0.35, "Rating": 10},
      "Data Migration": {"Weightage": 0.05, "Rating": 10},
      "Organizational change management": {"Weightage": 0.02, "Rating": 0},
      "Post Implementation Support": {"Weightage": 0.03, "Rating": 10},
      "Custom Objects Considered (RICEF)": {"Weightage": 0.15, "Rating": 5},
      "Project Duration": {"Weightage": 0.05, "Rating": 10},
      "Implementation Timeline / Consultants": {"Weightage": 0.20, "Rating": 8.33},
      "Partner Experience": {"Weightage": 0.10, "Rating": 7.22},
      "Reference (>1 Million Dollar) - Public Service Domain": {"Weightage": 0.05, "Rating": 20},
      "Reference # 1 - GCC region": {"Weightage": null, "Rating": 0},
      "Reference # 1 - Non-GCC region": {"Weightage": null, "Rating": 10}
    }
  }
]

INSTRUCTIONS:
1. Search the document for company names in tables/headers
2. For each company, find their column in the evaluation table
3. Extract ratings and weightages from the corresponding rows
4. Return JSON array with ALL companies found
5. Use null for missing values

Return ONLY the JSON array, starting with [ and ending with ].`;
          rawResponse = await ollamaChat({
            model: MODEL,
            messages: [
              { role: "system", content: "Extract evaluation matrix data. Return ONLY a valid JSON array. Start with [ and end with ]. Include ALL companies found." },
              { role: "user", content: retryPrompt },
            ],
            temperature: 0,
          });
          continue;
        }
      }
    } catch (error) {
      console.error(`❌ Parse attempt ${parseAttempts + 1} failed:`, error.message);
      if (rawResponse) {
        console.error(`❌ Raw response (first 500 chars): ${rawResponse.substring(0, 500)}`);
        console.error(`❌ Raw response (last 500 chars): ${rawResponse.substring(Math.max(0, rawResponse.length - 500))}`);
      }
      if (parseAttempts < maxParseAttempts - 1) {
        parseAttempts++;
        // Try with more explicit prompt and example
        const retryPrompt = `Extract companies and ratings. Return JSON array ONLY.

Document:
${relevantSection.substring(0, 10000)}

Example format:
[{"Company Name": "EDRAKY", "Overall Rating": 7.9, "Category-Level Weightage": null, "Category-Level Rating": 7.9, "Subcategory Ratings": {"Module Covered": {"Weightage": 0.35, "Rating": 10}}}]

Return ONLY the JSON array, no other text.`;
        try {
          rawResponse = await ollamaChat({
            model: MODEL,
            messages: [
              { role: "system", content: "Return ONLY a valid JSON array starting with [ and ending with ]. No markdown, no explanations, no code blocks." },
              { role: "user", content: retryPrompt },
            ],
            temperature: 0,
          });
          continue;
        } catch (retryError) {
          console.error("❌ Retry also failed:", retryError.message);
        }
      }
      const errorMsg = rawResponse 
        ? `Failed to parse AI response. Error: ${error.message}\n\nResponse preview:\n${rawResponse.substring(0, 1000)}`
        : `Failed to get AI response: ${error.message}`;
      throw new Error(errorMsg);
    }
  }

  // Step 4: Final validation
  if (!result || !Array.isArray(result)) {
    console.error("❌ Final validation failed - result is not an array");
    console.error("❌ Result type:", typeof result);
    console.error("❌ Raw response (first 1000 chars):", rawResponse?.substring(0, 1000) || "No response");
    throw new Error("AI response is not a JSON array.");
  }

  // Step 5: Ensure all required fields exist
  const validated = result.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Item ${idx} is not a valid object.`);
    }

    const validatedItem = {
      "Company Name": item["Company Name"] || `Company_${idx + 1}`,
      "Overall Rating": typeof item["Overall Rating"] === "number" ? item["Overall Rating"] : null,
      "Category-Level Weightage": typeof item["Category-Level Weightage"] === "number" ? item["Category-Level Weightage"] : null,
      "Category-Level Rating": typeof item["Category-Level Rating"] === "number" ? item["Category-Level Rating"] : null,
      "Subcategory Ratings": {},
    };

    // Validate subcategory ratings
    if (item["Subcategory Ratings"] && typeof item["Subcategory Ratings"] === "object") {
      const subcats = item["Subcategory Ratings"];
      const requiredSubcats = [
        "Module Covered",
        "Data Migration",
        "Organizational change management",
        "Post Implementation Support",
        "Custom Objects Considered (RICEF)",
        "Project Duration",
        "Implementation Timeline / Consultants",
        "Partner Experience",
        "Reference (>1 Million Dollar) - Public Service Domain",
        "Reference # 1 - GCC region",
        "Reference # 1 - Non-GCC region",
      ];

      for (const subcat of requiredSubcats) {
        if (subcats[subcat] && typeof subcats[subcat] === "object") {
          validatedItem["Subcategory Ratings"][subcat] = {
            Weightage: typeof subcats[subcat].Weightage === "number" ? subcats[subcat].Weightage : null,
            Rating: typeof subcats[subcat].Rating === "number" ? subcats[subcat].Rating : null,
          };
        } else {
          validatedItem["Subcategory Ratings"][subcat] = {
            Weightage: null,
            Rating: null,
          };
        }
      }
    } else {
      // Initialize all subcategories with null values
      const requiredSubcats = [
        "Module Covered",
        "Data Migration",
        "Organizational change management",
        "Post Implementation Support",
        "Custom Objects Considered (RICEF)",
        "Project Duration",
        "Implementation Timeline / Consultants",
        "Partner Experience",
        "Reference (>1 Million Dollar) - Public Service Domain",
        "Reference # 1 - GCC region",
        "Reference # 1 - Non-GCC region",
      ];
      for (const subcat of requiredSubcats) {
        validatedItem["Subcategory Ratings"][subcat] = { Weightage: null, Rating: null };
      }
    }

    return validatedItem;
  });

  console.log(`✅ Extraction complete. Found ${validated.length} companies.`);
  return validated;
}
