#!/usr/bin/env node

/**
 * API Monitoring Script
 * Hits the Tender Gap Analyzer API every 30 seconds
 */

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const API_URL = process.env.API_URL || 'https://tender-intake.onrender.com/analyze';
const DOCUMENT_PATH = process.env.DOCUMENT_PATH || '/home/gaian/Downloads/6565dbb36c16dTenderdoc144.pdf';
const DEPARTMENT = process.env.DEPARTMENT || 'healthcare management';
const CATEGORY = process.env.CATEGORY || 'Works'; // Optional
const INTERVAL = parseInt(process.env.INTERVAL || '30', 10) * 1000; // Convert to milliseconds

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest() {
  try {
    // Check if file exists
    if (!fs.existsSync(DOCUMENT_PATH)) {
      log(`❌ Error: Document file not found: ${DOCUMENT_PATH}`, 'red');
      return null;
    }

    // Build curl command
    const curlCommand = [
      'curl',
      '-s',
      '-w', '\\n%{http_code}',
      '--location',
      '--request', 'POST',
      `"${API_URL}"`,
      `--form "document=@${DOCUMENT_PATH}"`,
      `--form "department=${DEPARTMENT}"`,
      `--form "category=${CATEGORY}"`,
    ].join(' ');

    const { stdout, stderr } = await execAsync(curlCommand);

    if (stderr) {
      log(`⚠ Warning: ${stderr}`, 'yellow');
    }

    // Parse response
    const lines = stdout.trim().split('\n');
    const httpCode = parseInt(lines[lines.length - 1], 10);
    const body = lines.slice(0, -1).join('\n');

    return { httpCode, body };
  } catch (error) {
    log(`❌ Error making request: ${error.message}`, 'red');
    return null;
  }
}

async function parseResponse(body) {
  try {
    const data = JSON.parse(body);
    return {
      success: data.success || false,
      score: data.result?.completenessAssessment?.overallScore || null,
      filename: data.filename || null,
      missingSections: data.result?.completenessAssessment?.missingSections?.length || 0,
      weakSections: data.result?.completenessAssessment?.weakSections?.length || 0,
      error: data.error || null,
    };
  } catch (error) {
    return { success: false, error: 'Failed to parse JSON' };
  }
}

async function run() {
  log('🚀 Starting API Monitor', 'cyan');
  log(`   API URL: ${API_URL}`, 'cyan');
  log(`   Document: ${DOCUMENT_PATH}`, 'cyan');
  log(`   Department: ${DEPARTMENT}`, 'cyan');
  log(`   Category: ${CATEGORY}`, 'cyan');
  log(`   Interval: ${INTERVAL / 1000} seconds`, 'cyan');
  log('   Press Ctrl+C to stop\n', 'yellow');

  // Check if file exists
  if (!fs.existsSync(DOCUMENT_PATH)) {
    log(`❌ Error: Document file not found: ${DOCUMENT_PATH}`, 'red');
    process.exit(1);
  }

  let count = 0;

  // Main loop
  while (true) {
    count++;
    const timestamp = new Date().toLocaleString();
    
    log(`[${timestamp}] Request #${count}`, 'yellow');

    const response = await makeRequest();

    if (response) {
      if (response.httpCode === 200) {
        log(`✓ Success (HTTP ${response.httpCode})`, 'green');
        
        const parsed = await parseResponse(response.body);
        
        if (parsed.success) {
          if (parsed.score !== null) {
            log(`   Score: ${parsed.score}/100`, 'green');
          }
          if (parsed.filename) {
            log(`   File: ${parsed.filename}`);
          }
          if (parsed.missingSections > 0 || parsed.weakSections > 0) {
            log(`   Missing: ${parsed.missingSections}, Weak: ${parsed.weakSections}`);
          }
        } else if (parsed.error) {
          log(`   Error: ${parsed.error}`, 'red');
        }
      } else {
        log(`✗ Failed (HTTP ${response.httpCode})`, 'red');
        const preview = response.body.substring(0, 200);
        log(`   Response: ${preview}${preview.length < response.body.length ? '...' : ''}`);
      }
    }

    console.log(''); // Empty line for readability

    // Wait before next request
    await new Promise(resolve => setTimeout(resolve, INTERVAL));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\n\n👋 Stopping API Monitor...', 'yellow');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('\n\n👋 Stopping API Monitor...', 'yellow');
  process.exit(0);
});

// Start monitoring
run().catch(error => {
  log(`❌ Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
