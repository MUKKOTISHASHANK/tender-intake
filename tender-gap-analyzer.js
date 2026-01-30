#!/usr/bin/env node
// Load environment variables from .env file
import "dotenv/config";

import app from "./src/app.js";

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log("");
  console.log("🚀 Tender Gap Analyzer API Server");
  console.log(`   Listening on http://${HOST}:${PORT}`);
  console.log(`   Health check: http://${HOST}:${PORT}/health`);
  console.log(`   Extract endpoint: POST http://${HOST}:${PORT}/extract`);
  console.log(`   Extract Artifacts endpoint: POST http://${HOST}:${PORT}/extract-artifacts`);
  console.log(`   Extract Matrix endpoint: POST http://${HOST}:${PORT}/extract-matrix`);
  console.log(`   Analyze endpoint: POST http://${HOST}:${PORT}/analyze`);
  console.log(`   Evaluate RFP endpoint: POST http://${HOST}:${PORT}/evaluate-rfp`);
  console.log(`   Pre-Bid Queries endpoint: POST http://${HOST}:${PORT}/pre-bid-queries/analyze`);
  console.log(`   Categories endpoint: GET http://${HOST}:${PORT}/categories`);
  console.log(`   Keywords endpoint: GET http://${HOST}:${PORT}/keywords/:category`);
  console.log("");
});

