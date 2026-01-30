import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { analyze } from "../services/analysisService.js";
import { loadKeywordsFromExcel } from "../services/keywordRulesService.js";
import { extractTender } from "../services/tenderExtractionService.js";

const router = Router();

// Configure multer for file uploads
const uploadsDir = path.resolve(process.cwd(), "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `file-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".docx", ".doc", ".txt", ".html", ".htm"].includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format: ${ext}. Supported formats: .pdf, .docx, .doc, .txt, .html, .htm`
        )
      );
    }
  },
});

// POST /extract
router.post("/extract", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Please provide a 'document' file.",
      });
    }

    const tenderId = req.body.tenderId || null;
    const departmentName = req.body.departmentName || null;
    const quickMode = req.body.quickMode === "true" || req.query.quickMode === "true";

    console.log(`\n📄 Extracting tender data from: ${req.file.originalname}`);
    console.log(`📋 Tender ID: ${tenderId || "Not provided"}`);
    console.log(`🏢 Department: ${departmentName || "Not provided"}`);
    console.log(`⚡ Quick Mode: ${quickMode ? "ENABLED (faster, less thorough)" : "DISABLED (slower, more thorough)"}`);

    // Temporarily set environment variables for quick mode
    if (quickMode) {
      process.env.SKIP_TARGETED_FILL = "true";
      process.env.SKIP_FINAL_NORMALIZE = "true";
      process.env.MAX_CONCURRENT_CHUNKS = "10";
    }

    const result = await extractTender({
      filePath: req.file.path,
      tenderId,
      departmentName,
    });

    // Clean up environment variables
    if (quickMode) {
      delete process.env.SKIP_TARGETED_FILL;
      delete process.env.SKIP_FINAL_NORMALIZE;
      delete process.env.MAX_CONCURRENT_CHUNKS;
    }

    console.log(`✓ Extraction complete. Tender: ${result.metadata.tender_reference_number}`);

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.json(result);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Extraction error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "An error occurred during tender extraction",
    });
  }
});

// POST /analyze
router.post("/analyze", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Please provide a 'document' file.",
      });
    }

    const { department, category } = req.body;

    console.log(`\n📄 Processing file: ${req.file.originalname}`);
    console.log(`📋 Department: ${department || "auto-detect"}`);
    console.log(`🏷️  Gap Category filter: ${category || "all (no filter)"}`);
    console.log(
      `   Note: Category should be a gap category (Administrative, Technical, Financial, etc.), not a tender category (Works, Services, etc.)`
    );

    const result = await analyze(
      req.file.path,
      department || null,
      category || null,
      req.file.originalname
    );

    console.log(
      `✓ Analysis complete. Score: ${result.completenessAssessment.overallScore}`
    );

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.json({
      success: true,
      filename: req.file.originalname,
      result,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Analysis error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "An error occurred during analysis",
    });
  }
});

// GET /categories
router.get("/categories", (req, res) => {
  try {
    const keywords = loadKeywordsFromExcel();
    const categories = [...new Set(keywords.map((k) => k.category))].sort();
    return res.json({
      success: true,
      categories,
      totalRules: keywords.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /keywords/:category
router.get("/keywords/:category", (req, res) => {
  try {
    const { category } = req.params;
    const keywords = loadKeywordsFromExcel();
    const filtered = keywords.filter(
      (k) => (k.category || "").toLowerCase() === category.toLowerCase()
    );
    return res.json({
      success: true,
      category,
      keywords: filtered,
      count: filtered.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

