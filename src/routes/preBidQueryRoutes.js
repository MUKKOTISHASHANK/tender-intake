import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { analyzePreBidQueries } from "../services/preBidQueryService.js";

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
    if ([".pdf", ".docx", ".doc", ".txt", ".html", ".htm", ".md"].includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format: ${ext}. Supported formats: .pdf, .docx, .doc, .txt, .html, .htm, .md`
        )
      );
    }
  },
});

// POST /pre-bid-queries/analyze
router.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Please provide a 'file' in multipart form-data.",
      });
    }

    const vendorCompanyName = req.body.vendorCompanyName || req.body.vendor || null;
    const authorityName = req.body.authorityName || req.body.authority || null;
    const projectName = req.body.projectName || req.body.project || null;

    console.log(`\n📄 Processing pre-bid queries from: ${req.file.originalname}`);
    console.log(`🏢 Vendor: ${vendorCompanyName || "Not provided"}`);
    console.log(`🏛️  Authority: ${authorityName || "Not provided"}`);
    console.log(`📋 Project: ${projectName || "Not provided"}`);

    // Read file buffer
    const buffer = fs.readFileSync(req.file.path);

    const result = await analyzePreBidQueries({
      buffer,
      filename: req.file.originalname,
      vendorCompanyName: vendorCompanyName ? String(vendorCompanyName).trim() : null,
      authorityName: authorityName ? String(authorityName).trim() : null,
      projectName: projectName ? String(projectName).trim() : null,
    });

    console.log(`✓ Pre-bid query analysis complete. Found ${result.sections.length} sections.`);

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Return JSON only (as per requirements)
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(result);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Pre-bid query analysis error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "An error occurred during pre-bid query analysis",
    });
  }
});

export default router;
