# RFP Evaluation Mapping API

This API endpoint extracts evaluation criteria from RFP/Tender documents and maps them to a fixed JSON schema.

## Endpoint

**POST** `/evaluate-rfp`

## Features

- **Keyword-based extraction**: Uses keyword rules to quickly identify relevant sections
- **AI-powered mapping**: Uses Ollama to extract and structure evaluation data
- **Multi-format support**: Supports PDF, DOCX, DOC, and TXT files
- **Schema validation**: Automatically validates and repairs JSON output to match exact schema
- **Fast processing**: Optimized chunking and parallel extraction where possible

## Request

### Headers
- `Content-Type: multipart/form-data`

### Form Data
- `document` (file, required): The RFP/Tender document file (PDF, DOCX, DOC, or TXT)
- `department` or `dept` (string, optional): Department name for context (defaults to "Unknown")

### Example using curl

```bash
# Basic request with PDF
curl -X POST http://localhost:3000/evaluate-rfp \
  -F "document=@/path/to/your/rfp-document.pdf" \
  -F "department=PSD" \
  -H "Accept: application/json"

# With DOCX file
curl -X POST http://localhost:3000/evaluate-rfp \
  -F "document=@/path/to/your/rfp-document.docx" \
  -F "department=RAK PSD Dept." \
  -H "Accept: application/json"

# With TXT file
curl -X POST http://localhost:3000/evaluate-rfp \
  -F "document=@/path/to/your/rfp-document.txt" \
  -F "dept=IT Department" \
  -H "Accept: application/json"
```

### Example using JavaScript (fetch)

```javascript
const formData = new FormData();
formData.append('document', fileInput.files[0]);
formData.append('department', 'PSD');

const response = await fetch('http://localhost:3000/evaluate-rfp', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.evaluation);
```

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "filename": "rfp-document.pdf",
  "department": "PSD",
  "evaluation": {
    "A1_Financial_Evaluation": {
      "weight": "50%",
      "sections": [
        {
          "scoring_area": "Financial Evaluation",
          "weight": "100%",
          "requirements": [
            {
              "group": "BOQ Completeness",
              "requirement_ids": ["N/A"],
              "description": "Matching of BOQ components to scope of work.",
              "evidence_required": "Completed BOQ."
            }
          ]
        }
      ]
    },
    "A2_Technical_Evaluation": {
      "weight": "50%",
      "subsections": {
        "A2_1_Functional_Technical_Compliance": {
          "weight": "30%",
          "requirements": [...]
        }
      }
    },
    "A3_Mandatory_Compliance": {
      "outcome": "Pass/Fail",
      "requirements": [...]
    },
    "A4_Support_and_SLA": {
      "requirements": [...]
    }
  }
}
```

### Error Response (400/500)

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

## Output Schema

The evaluation output follows a strict schema with the following structure:

- **A1_Financial_Evaluation**: Financial/commercial evaluation criteria, weights, and disqualification rules
- **A2_Technical_Evaluation**: Technical evaluation with subsections:
  - A2_1_Functional_Technical_Compliance
  - A2_2_Implementation_Plan
  - A2_3_Training_Plan
  - A2_4_Team_Qualifications
  - A2_5_Similar_Project_Experience
- **A3_Mandatory_Compliance**: Pass/fail mandatory requirements
- **A4_Support_and_SLA**: Support and SLA requirements (Availability, Response Time, Support Hours, Backup)

## Configuration

The service uses the following environment variables (from `src/config/ollamaConfig.js`):

- `OLLAMA_URL`: Ollama API base URL (default: `http://ollama-sales.mobiusdtaas.ai/api`)
- `OLLAMA_MODEL`: Model name (default: `gpt-oss:120b`)
- `OLLAMA_ENABLED`: Enable/disable Ollama (default: `true`)

## How It Works

1. **Document Reading**: Extracts text from PDF, DOCX, DOC, or TXT files
2. **Keyword-Based Section Identification**: Uses keyword rules to identify relevant sections for each evaluation category
3. **AI Extraction**: Uses Ollama to extract facts, weights, and numbers from identified sections
4. **Schema Mapping**: Maps extracted data to the fixed JSON schema
5. **Validation & Repair**: Validates output against schema and auto-repairs if needed

## Performance

- Processes documents in chunks (20,000 characters per chunk)
- Uses keyword-based pre-filtering to reduce AI processing time
- Validates and repairs JSON output automatically
- Typically processes standard RFP documents in 30-120 seconds depending on size

## Notes

- The service automatically handles documents of any size by chunking
- If information is not found in the document, fields are set to "Not specified in the document" or "N/A"
- The output schema is fixed and cannot be modified - all keys and hierarchy must match exactly
- The service uses keyword rules from `Tender_Keywords_56_Rows_FULL.xlsx` if available
