import fs from "fs";
import path from "path";
import { createRequire } from "module";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

export async function readDocxText(docxPath) {
  const result = await mammoth.extractRawText({ path: docxPath });
  return (result.value || "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n");
}

export async function readPdfText(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text || "";

    if (!text || text.trim().length === 0) {
      throw new Error(
        "PDF file appears to be empty or could not extract text. The PDF might be image-based or encrypted."
      );
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

/**
 * Read document text from an uploaded file.
 * Uses the original filename (with extension) to detect type.
 */
export async function readDocumentText(filePath, originalFileName = null) {
  let ext = "";

  if (originalFileName) {
    ext = path.extname(originalFileName).toLowerCase();
  } else {
    ext = path.extname(filePath).toLowerCase();
  }

  if (!ext && originalFileName) {
    ext = path.extname(originalFileName).toLowerCase();
  }

  try {
    if (ext === ".pdf") {
      return await readPdfText(filePath);
    } else if (ext === ".docx" || ext === ".doc") {
      return await readDocxText(filePath);
    } else {
      throw new Error(
        `Unsupported file format: ${ext || "unknown"}. Supported formats: .pdf, .docx, .doc`
      );
    }
  } catch (error) {
    if (error.message.includes("Unsupported")) {
      throw error;
    }
    const name = path.basename(originalFileName || filePath);
    throw new Error(
      `Error reading ${ext.toUpperCase() || "FILE"} file "${name}": ${error.message}`
    );
  }
}

