# Quick Reference: Tender Extraction Optimization Prompt

## For Future Development/Similar Projects

**Problem:** Document extraction taking 5+ minutes (processing 44 chunks sequentially)

**Solution:** Hybrid regex + targeted AI approach

### Key Strategy:
1. **Use regex for structured data** (80% of fields) - instant extraction
2. **Use AI only for complex fields** (20% of fields) - 2-3 targeted calls
3. **Target specific document sections** - don't process entire document
4. **Smart section detection** - search for keywords to find relevant sections

### Implementation Steps:

**Step 1: AI Metadata Extraction (First 3000 chars)**
- Extract: reference_number, title, type, issue_date, issuer, country
- Prompt: Specific instructions per field, examples, context
- Fallback: Regex patterns if AI fails

**Step 2: Regex Fast Extraction**
- Extract: dates, emails, phones, currency, deadlines, validity
- Use multiple regex patterns with fallbacks
- Instant processing (<1 second)

**Step 3: Section Detection**
- Search document for evaluation keywords
- Extract section (100 lines after keyword)
- Fallback to middle section (30-70%) if not found

**Step 4: AI Complex Fields (2-3 calls max)**
- First 5000 chars: summary/intro
- Evaluation section: criteria extraction
- Last 5000 chars: requirements
- Dedicated fallback for evaluation if empty

**Step 5: Merge & Validate**
- Combine all extractions
- Normalize data types
- Validate against schema

### Performance:
- **Before:** 5+ minutes, 25+ AI calls, 474K chars processed
- **After:** 15-30 seconds, 2-3 AI calls, ~15K chars processed
- **Improvement:** 10-20x faster, 97% less text processed

### Key Principles:
1. **Right tool for the job:** Regex for structured, AI for interpretation
2. **Target sections:** Don't process entire document
3. **Layered fallbacks:** Multiple extraction strategies
4. **Specific prompts:** Detailed instructions produce better results
5. **Smart detection:** Keyword-based section finding

### Prompt Engineering Tips:
- Provide context (tenderId, departmentName)
- List specific keywords to search for
- Give examples of expected values
- Emphasize extracting ALL items (not just first few)
- Specify fallback values clearly
- Separate sections in prompt for clarity

### Code Pattern:
```javascript
// 1. Fast regex extraction
const simpleFields = extractWithRegex(text, patterns);

// 2. AI for metadata (first 3000 chars)
const metadata = await extractMetadataWithAI(text.substring(0, 3000));

// 3. Section detection
const evalSection = findSection(text, ["evaluation", "scoring", "criteria"]);

// 4. AI for complex fields (targeted sections)
const complexFields = await extractComplexFields({
  summary: text.substring(0, 5000),
  evaluation: evalSection,
  requirements: text.substring(text.length - 5000)
});

// 5. Merge and validate
const result = mergeAndValidate(simpleFields, metadata, complexFields);
```

### When to Use This Approach:
✅ Large documents (100K+ characters)
✅ Structured data mixed with unstructured
✅ Need fast extraction (<1 minute)
✅ Multiple field types (simple + complex)
✅ Documents with clear sections

### When NOT to Use:
❌ Very small documents (<10K chars) - just use AI
❌ Highly unstructured documents - need full AI processing
❌ Need 100% accuracy - may need full document analysis
