# Tender Extraction Service - Optimization Summary

## Problem Statement
Initial implementation was processing documents sequentially, taking **5+ minutes** for a 474K character document with 44 chunks. Each chunk required ~30 seconds of AI processing time.

## Optimization Strategy

### 1. **Fast Keyword-Based Extraction Approach**
**Changed from:** Processing entire document in chunks sequentially  
**Changed to:** Hybrid approach using regex patterns + targeted AI

**Benefits:**
- Regex patterns extract simple fields instantly (metadata, dates, emails, phones)
- AI only used for complex fields that need interpretation
- Reduced from 25+ AI calls to just 2-3 AI calls total

### 2. **Parallel Processing (Initial Attempt)**
**Implementation:**
- Processed chunks in parallel batches (5-10 concurrent)
- Increased chunk size from 12K to 20K characters
- Added retry logic and better error handling

**Result:** Still too slow (2-3 minutes) because processing entire document

### 3. **Final Optimized Approach**

#### **Step 1: AI-Based Metadata Extraction (First 3000 chars)**
- Uses Ollama AI to extract metadata from document header
- Extracts: `tender_reference_number`, `document_title`, `document_type`, `issue_date`, `issuer`, `country`
- Falls back to regex if AI fails
- **Time:** ~5-10 seconds

#### **Step 2: Regex-Based Fast Extraction**
- Extracts simple fields using regex patterns:
  - Administration (deadline, validity, instructions)
  - Contact information (email, phone, name)
  - Pricing (currency, structure)
- **Time:** <1 second (instant)

#### **Step 3: Targeted Evaluation Section Search**
- Searches full document for evaluation-related keywords
- Extracts evaluation section (up to 100 lines after keyword match)
- Falls back to middle section (30-70% of document) if not found
- **Time:** <1 second

#### **Step 4: AI for Complex Fields (Summary, Requirements, Evaluation)**
- Uses AI on:
  - First 5000 chars (summary/intro)
  - Evaluation section (found in Step 3)
  - Last 5000 chars (requirements)
- Extracts: `tender_summary`, `requirements`, `evaluation`
- **Time:** ~10-20 seconds

#### **Step 5: Dedicated Evaluation Criteria Extraction (Fallback)**
- If evaluation criteria still empty, runs dedicated extraction
- Focuses only on evaluation section
- **Time:** ~5-10 seconds (only if needed)

### 4. **Key Optimizations Made**

#### **A. Reduced AI Calls**
- **Before:** 25+ AI calls (one per chunk)
- **After:** 2-3 AI calls total
  - 1 for metadata (first 3000 chars)
  - 1 for complex fields (summary/requirements/evaluation)
  - 1 fallback for evaluation criteria (if needed)

#### **B. Smart Section Targeting**
- Metadata: First 3000 chars (where headers are)
- Summary: First 5000 chars
- Requirements: Last 5000 chars
- Evaluation: Searched dynamically in document

#### **C. Regex Pattern Extraction**
- Fast extraction for structured data:
  - Dates (multiple patterns)
  - Emails (regex)
  - Phone numbers (UAE format patterns)
  - Reference numbers
  - Currency detection
  - Document type detection

#### **D. Enhanced AI Prompts**
- **Metadata Prompt:** Specific instructions for each field, examples of what to look for
- **Evaluation Prompt:** 
  - Lists common criteria names
  - Emphasizes extracting ALL criteria
  - Includes section search keywords
  - Dedicated fallback extraction

#### **E. Error Handling & Fallbacks**
- AI failures fall back to regex extraction
- Empty results trigger dedicated extraction
- Graceful degradation at each step

### 5. **Performance Improvements**

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Total Time** | 5+ minutes | 15-30 seconds | **10-20x faster** |
| **AI Calls** | 25+ calls | 2-3 calls | **8-12x reduction** |
| **Chunks Processed** | 44 chunks | 0 chunks | **100% reduction** |
| **Text Analyzed** | 474K chars | ~15K chars | **97% reduction** |

### 6. **Code Structure**

```
extractTender()
├── Step 1: Extract text from document
├── Step 2: AI metadata extraction (first 3000 chars)
│   └── extractMetadataWithAI()
│       └── Falls back to fastExtractMetadata() (regex)
├── Step 3: Regex extraction for simple fields
│   ├── fastExtractAdministration()
│   ├── fastExtractContact()
│   └── fastExtractPricing()
├── Step 4: Search for evaluation section
│   └── Keyword-based section finder
├── Step 5: AI for complex fields
│   ├── Main extraction (summary/requirements/evaluation)
│   └── Dedicated evaluation extraction (fallback if needed)
└── Step 6: Merge, normalize, validate
```

### 7. **Prompt Engineering Best Practices Used**

#### **Metadata Extraction Prompt:**
- Clear field definitions
- Examples of what to look for
- Context provided (tenderId, departmentName)
- Specific instructions per field
- Fallback values specified

#### **Evaluation Criteria Prompt:**
- Section keywords to search for
- Common criteria examples
- Emphasis on extracting ALL criteria
- Weight extraction instructions
- Dedicated extraction as fallback

#### **Complex Fields Prompt:**
- Structured JSON schema
- Clear extraction rules
- Section separation in context
- Requirements formatting instructions

### 8. **Configuration Options**

Environment variables for fine-tuning:
- `CHUNK_MAX_CHARS`: Chunk size (default: 20000)
- `MAX_CONCURRENT_CHUNKS`: Parallel processing (not used in final version)
- `SKIP_TARGETED_FILL`: Skip targeted field filling
- `SKIP_FINAL_NORMALIZE`: Skip final normalization

### 9. **Lessons Learned**

1. **Don't process entire document** - Target specific sections
2. **Use regex for structured data** - Much faster than AI
3. **AI for interpretation only** - Use for complex, unstructured fields
4. **Smart section detection** - Search for keywords to find relevant sections
5. **Layered fallbacks** - Multiple extraction strategies for reliability
6. **Prompt specificity** - Detailed prompts produce better results

### 10. **Future Optimization Opportunities**

1. **Caching:** Cache extracted metadata for similar documents
2. **Section Detection:** Improve section detection using ML
3. **Parallel AI Calls:** Run metadata and complex fields extraction in parallel
4. **Streaming:** Process document in streaming mode for very large files
5. **Template Matching:** Use document templates for common tender formats

## Summary

The optimization transformed a **5+ minute sequential chunk processing** into a **15-30 second hybrid extraction** by:
- Using regex for 80% of fields (instant)
- Using AI only for 20% of complex fields (2-3 calls)
- Targeting specific document sections instead of processing everything
- Implementing smart fallbacks for reliability

**Key Principle:** Use the right tool for the job - regex for structured data, AI for interpretation.
