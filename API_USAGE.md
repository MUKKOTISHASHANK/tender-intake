# Tender Gap Analyzer API Usage

## Installation

First, install the required dependencies:

```bash
npm install
```

## Starting the Server

```bash
node tender-gap-analyzer.js
```

The server will start on `http://localhost:3000` by default.

## API Endpoints

### 1. Health Check
**GET** `/health`

Check if the API is running.

**Response:**
```json
{
  "status": "ok",
  "message": "Tender Gap Analyzer API is running"
}
```

### 2. Analyze Document
**POST** `/analyze`

Analyze a tender document for gaps.

**Request:**
- **Content-Type:** `multipart/form-data`
- **Body:**
  - `document` (file, required): The tender document file (.pdf, .docx, or .doc)
  - `department` (string, optional): Department name (e.g., "Public Services Department")
  - `category` (string, optional): **Gap category** to filter rules. Valid values:
    - `Administrative`
    - `Technical`
    - `Financial`
    - `Support/SLA`
    - `Compliance`
    - `Governance`
    - `Risk Management`
    - `Integration`
    - `KPI & Performance`
    
    **Note:** This is NOT a tender category (like "Works", "Services", "Supplies", "Consultancy"). If you provide an invalid gap category or a tender category, all rules will be used for comprehensive analysis.

**Example using curl:**
```bash
curl -X POST http://localhost:3000/analyze \
  -F "document=@/path/to/your/document.pdf" \
  -F "department=Public Services Department" \
  -F "category=Technical"
```

**Example using JavaScript (fetch):**
```javascript
const formData = new FormData();
formData.append('document', fileInput.files[0]);
formData.append('department', 'Public Services Department');
formData.append('category', 'Technical');

fetch('http://localhost:3000/analyze', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

**Response:**
```json
{
  "success": true,
  "filename": "document.pdf",
  "result": {
    "documentInfo": {
      "title": "...",
      "department": "...",
      "documentType": "RFP",
      "year": 2024,
      "notes": "..."
    },
    "completenessAssessment": {
      "overallScore": 72,
      "summary": "...",
      "missingSections": [...],
      "weakSections": [...],
      "unclearSections": [...],
      "outdatedContent": [...]
    },
    "gapCategories": {
      "Administrative": [...],
      "Technical": [...],
      ...
    },
    "criticalRisks": {
      "highImpactRisks": [...],
      "mediumImpactRisks": [...],
      "lowImpactRisks": [...]
    },
    "recommendations": {
      "Administrative": [...],
      "Technical": [...],
      ...
    }
  }
}
```

### 3. Get Available Categories
**GET** `/categories`

Get all available categories from the Excel keywords file.

**Response:**
```json
{
  "success": true,
  "categories": [
    "Administrative",
    "Technical",
    "Financial",
    ...
  ],
  "totalRules": 56
}
```

### 4. Get Keywords for Category
**GET** `/keywords/:category`

Get all keywords/rules for a specific category.

**Example:**
```bash
curl http://localhost:3000/keywords/Technical
```

**Response:**
```json
{
  "success": true,
  "category": "Technical",
  "keywords": [
    {
      "name": "...",
      "category": "Technical",
      "where": [...],
      "presence": [...],
      "quality_requires": [...],
      "unclear_triggers": [...],
      "outdated_triggers": [...],
      "required": true
    },
    ...
  ],
  "count": 10
}
```

## Excel File Format

The API reads keywords from `Tender_Keywords_56_Rows_FULL.xlsx` in the same directory.

Expected columns (case-insensitive):
- **Category** / **Gap Category**: The gap category (e.g., "Administrative", "Technical")
- **Keyword** / **Term** / **Phrase** / **Requirement**: The keyword or requirement name
- **Presence** / **Pattern** / **Match**: Patterns to check for presence (comma-separated)
- **Quality** / **Requires** / **Detail**: Quality requirements (comma-separated)
- **Unclear** / **Ambiguous** / **Trigger**: Unclear triggers (comma-separated)
- **Outdated** / **Legacy** / **Old**: Outdated technology patterns (comma-separated)
- **Required** / **Mandatory**: "true"/"yes"/"1" for required, otherwise optional
- **Where** / **Section** / **Location**: Sections to search (comma-separated, default: "FULL")
- **Name** / **Rule** / **Requirement**: Rule name (defaults to keyword if not provided)

## Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `OLLAMA_ENABLED`: Enable/disable AI features (default: true)

## Notes

- Uploaded files are automatically deleted after processing
- Maximum file size: 50MB
- Supported file formats: .pdf, .docx, .doc
- If the Excel file is not found or empty, default rules will be used
- If `department` or `category` is not provided, they will be auto-detected from the document
