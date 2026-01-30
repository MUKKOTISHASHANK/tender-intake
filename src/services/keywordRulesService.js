import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { GAP_CATEGORIES } from "../utils/constants.js";

const KEYWORDS_EXCEL_FILE = path.resolve(
  process.cwd(),
  "Tender_Keywords_56_Rows_FULL.xlsx"
);

export function loadKeywordsFromExcel() {
  try {
    if (!fs.existsSync(KEYWORDS_EXCEL_FILE)) {
      console.error(
        `❌ ERROR: Keywords Excel file not found: ${KEYWORDS_EXCEL_FILE}`
      );
      console.error(
        "   Please ensure the file exists in the project root directory."
      );
      return [];
    }

    console.log(`📊 Loading keywords from: ${KEYWORDS_EXCEL_FILE}`);
    const workbook = XLSX.readFile(KEYWORDS_EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (data.length === 0) {
      console.error("❌ ERROR: Excel file is empty or has no data");
      return [];
    }

    if (data.length < 2) {
      console.error("❌ ERROR: Excel file has no data rows (only header or empty)");
      return [];
    }

    const headers = data[0] || [];
    const keywords = [];

    const categoryIdx = headers.findIndex((h) =>
      /category|gap.category|gap_category/i.test(String(h))
    );
    const keywordIdx = headers.findIndex((h) =>
      /keyword|term|phrase|requirement/i.test(String(h))
    );
    const presenceIdx = headers.findIndex((h) =>
      /presence|pattern|match/i.test(String(h))
    );
    const qualityIdx = headers.findIndex((h) =>
      /quality|requires|detail/i.test(String(h))
    );
    const unclearIdx = headers.findIndex((h) =>
      /unclear|ambiguous|trigger/i.test(String(h))
    );
    const outdatedIdx = headers.findIndex((h) =>
      /outdated|legacy|old/i.test(String(h))
    );
    const requiredIdx = headers.findIndex((h) =>
      /required|mandatory/i.test(String(h))
    );
    const whereIdx = headers.findIndex((h) =>
      /where|section|location/i.test(String(h))
    );
    const nameIdx = headers.findIndex((h) =>
      /name|rule|requirement/i.test(String(h))
    );

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const category =
        categoryIdx >= 0 ? String(row[categoryIdx] || "").trim() : "";
      const keyword =
        keywordIdx >= 0 ? String(row[keywordIdx] || "").trim() : "";
      const presence =
        presenceIdx >= 0 ? String(row[presenceIdx] || "").trim() : keyword;
      const quality =
        qualityIdx >= 0 ? String(row[qualityIdx] || "").trim() : "";
      const unclear =
        unclearIdx >= 0 ? String(row[unclearIdx] || "").trim() : "";
      const outdated =
        outdatedIdx >= 0 ? String(row[outdatedIdx] || "").trim() : "";
      const required =
        requiredIdx >= 0
          ? String(row[requiredIdx] || "").trim().toLowerCase()
          : "false";
      const where =
        whereIdx >= 0 ? String(row[whereIdx] || "").trim() : "FULL";
      const name =
        nameIdx >= 0 ? String(row[nameIdx] || "").trim() : keyword || `Rule ${i}`;

      if (!category || !keyword) continue;

      const parseArray = (str) => {
        if (!str) return [];
        return str
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      };

      keywords.push({
        name,
        category,
        where: parseArray(where).length > 0 ? parseArray(where) : ["FULL"],
        presence: parseArray(presence).length > 0 ? parseArray(presence) : [keyword],
        quality_requires: parseArray(quality),
        unclear_triggers: parseArray(unclear),
        outdated_triggers: parseArray(outdated),
        required:
          required === "true" || required === "yes" || required === "1",
      });
    }

    if (keywords.length === 0) {
      console.error(
        "❌ ERROR: No valid keyword rules extracted from Excel file. Check column headers."
      );
      return [];
    }

    console.log(
      `✓ Successfully loaded ${keywords.length} keyword rules from Excel file`
    );
    return keywords;
  } catch (error) {
    console.error(`❌ ERROR loading keywords from Excel: ${error.message}`);
    return [];
  }
}

/**
 * Original hard-coded rules (baseline).
 * These ensure decent analysis even if Excel is missing or incomplete.
 */
export function buildOriginalRules() {
  return [
    // Administrative
    {
      name: "Submission guidelines and proposal instructions",
      category: "Administrative",
      where: ["Proposal Guidelines", "Instructions to Vendor", "FULL"],
      presence: [
        String.raw`Deadline for Submission`,
        String.raw`Last date for Submission`,
        String.raw`Send the proposal`,
        String.raw`submission of proposals`,
      ],
      quality_requires: [String.raw`format`, String.raw`deadline`, String.raw`email`],
      unclear_triggers: [String.raw`may.*extend`, String.raw`sole discretion`],
      outdated_triggers: [],
      required: true,
    },
    {
      name: "Dispute resolution and governing law",
      category: "Administrative",
      where: ["Instructions to Vendor", "FULL"],
      presence: [String.raw`Dispute Resolution`, String.raw`Governing Law`],
      quality_requires: [String.raw`courts`, String.raw`laws of UAE`],
      unclear_triggers: [],
      outdated_triggers: [],
      required: true,
    },

    // Governance
    {
      name: "Governance structure with roles and responsibilities",
      category: "Governance",
      where: ["Proposal Guidelines", "Rules, Assumptions", "FULL"],
      presence: [
        String.raw`roles and responsibilities`,
        String.raw`Program governance`,
        String.raw`steering`,
        String.raw`oversight`,
      ],
      quality_requires: [String.raw`matrix`, String.raw`stakeholder|stakeholders`],
      unclear_triggers: [
        String.raw`as required`,
        String.raw`as needed`,
        String.raw`to be agreed`,
      ],
      outdated_triggers: [],
      required: true,
    },

    // Technical
    {
      name: "Solution architecture / system landscape",
      category: "Technical",
      where: ["System Landscape", "Scope of Work", "FULL"],
      presence: [
        String.raw`System Landscape`,
        String.raw`solution architecture`,
        String.raw`servers`,
        String.raw`operating systems`,
      ],
      quality_requires: [
        String.raw`availability`,
        String.raw`redundancy|failover`,
        String.raw`version`,
      ],
      unclear_triggers: [
        String.raw`optimum configuration`,
        String.raw`as.*recommended`,
      ],
      outdated_triggers: [],
      required: true,
    },
    {
      name: "Cybersecurity and information security requirements",
      category: "Technical",
      where: ["System Landscape", "Scope of Work", "FULL"],
      presence: [
        String.raw`Information Security`,
        String.raw`Security`,
        String.raw`role-based`,
        String.raw`authentication`,
      ],
      quality_requires: [
        String.raw`access`,
        String.raw`controls`,
        String.raw`auditing|audit`,
      ],
      unclear_triggers: [String.raw`must propose`, String.raw`ensure`],
      outdated_triggers: [
        String.raw`Exchange\\s2010`,
        String.raw`FileNet\\sP8\\s*5\\.0`,
      ],
      required: true,
    },
    {
      name: "Data migration / conversion plan",
      category: "Technical",
      where: ["Scope of Work", "FULL"],
      presence: [
        String.raw`Data Conversion`,
        String.raw`data migration`,
        String.raw`migrate.*5 years`,
      ],
      quality_requires: [
        String.raw`validation`,
        String.raw`verification`,
        String.raw`plan`,
      ],
      unclear_triggers: [String.raw`will be reviewed`, String.raw`recommend`],
      outdated_triggers: [],
      required: true,
    },
    {
      name: "Testing strategy (UT/UAT/Integration/Stress/Security)",
      category: "Technical",
      where: ["Scope of Work", "FULL"],
      presence: [
        String.raw`Testing`,
        String.raw`UAT`,
        String.raw`Stress testing`,
        String.raw`Security testing`,
      ],
      quality_requires: [
        String.raw`Unit Testing`,
        String.raw`Integration Testing`,
        String.raw`User Acceptance Testing`,
      ],
      unclear_triggers: [],
      outdated_triggers: [],
      required: true,
    },

    // Integration
    {
      name: "Integration requirements with existing systems",
      category: "Integration",
      where: ["Scope of Work", "FULL"],
      presence: [
        String.raw`Interfaces`,
        String.raw`integration`,
        String.raw`bidirectional`,
        String.raw`web service`,
        String.raw`SAP HCM`,
        String.raw`FileNet`,
      ],
      quality_requires: [
        String.raw`mechanism`,
        String.raw`interface`,
        String.raw`systems`,
      ],
      unclear_triggers: [
        String.raw`to be identified`,
        String.raw`will be identified`,
      ],
      outdated_triggers: [String.raw`Exchange\\s*2010`],
      required: true,
    },

    // Support/SLA
    {
      name: "Support plan and SLA (response/resolution, severity, hours, windows)",
      category: "Support/SLA",
      where: ["Scope of Work", "FULL"],
      presence: [
        String.raw`Support Plan`,
        String.raw`SLA`,
        String.raw`Help Desk`,
        String.raw`Support Hours`,
      ],
      quality_requires: [
        String.raw`Severity`,
        String.raw`Response`,
        String.raw`Resolution`,
        String.raw`Maintenance Windows`,
      ],
      unclear_triggers: [String.raw`may be required`, String.raw`rate card`],
      outdated_triggers: [],
      required: true,
    },

    // Financial
    {
      name: "Commercial proposal and detailed pricing",
      category: "Financial",
      where: ["Proposal Guidelines", "Award of Contract", "FULL"],
      presence: [
        String.raw`Commercial Proposal`,
        String.raw`Price Schedule`,
        String.raw`UAE Dirhams`,
      ],
      quality_requires: [
        String.raw`fixed price`,
        String.raw`all costs`,
        String.raw`taxes|duties`,
      ],
      unclear_triggers: [],
      outdated_triggers: [],
      required: true,
    },
    {
      name: "TCO / total cost of ownership",
      category: "Financial",
      where: ["FULL"],
      presence: [String.raw`Total cost of ownership|TCO`],
      quality_requires: [],
      unclear_triggers: [],
      outdated_triggers: [],
      required: false,
    },
    {
      name: "Penalties / liquidated damages for delay",
      category: "Financial",
      where: ["Rules, Assumptions", "FULL"],
      presence: [
        String.raw`Delay Penalties`,
        String.raw`delay fee`,
        String.raw`not to exceed`,
      ],
      quality_requires: [String.raw`2000`, String.raw`10%`],
      unclear_triggers: [],
      outdated_triggers: [],
      required: true,
    },

    // Risk Management (optional)
    {
      name: "Risk management framework (scoring, ERM, mitigation)",
      category: "Risk Management",
      where: ["Proposal Guidelines", "Rules, Assumptions", "FULL"],
      presence: [
        String.raw`Risk Management`,
        String.raw`risk identification`,
        String.raw`mitigation`,
      ],
      quality_requires: [String.raw`scoring|risk scoring|risk register`],
      unclear_triggers: [],
      outdated_triggers: [],
      required: false,
    },

    // KPI & Performance (optional)
    {
      name: "KPIs and vendor performance measurement",
      category: "KPI & Performance",
      where: ["Scope of Work", "FULL"],
      presence: [
        String.raw`\\bKPI\\b`,
        String.raw`Key Performance`,
        String.raw`dashboards`,
      ],
      quality_requires: [
        String.raw`measurement`,
        String.raw`baseline`,
        String.raw`post-implementation`,
      ],
      unclear_triggers: [],
      outdated_triggers: [],
      required: false,
    },
  ];
}

/**
 * Merge original rules with Excel rules.
 * Excel rules override originals with the same name; new ones are appended.
 */
export function buildRulesFromKeywords(keywords) {
  const originalRules = buildOriginalRules();
  console.log(`✓ Loaded ${originalRules.length} original comprehensive rules`);

  if (!keywords || keywords.length === 0) {
    console.warn(
      "⚠ No keywords loaded from Excel, using original hard-coded rules only"
    );
    return originalRules;
  }

  console.log(`✓ Successfully loaded ${keywords.length} keyword rules from Excel`);

  const categoryCounts = {};
  keywords.forEach((k) => {
    categoryCounts[k.category] = (categoryCounts[k.category] || 0) + 1;
  });
  console.log(`✓ Excel category distribution:`, categoryCounts);

  const mergedRules = [...originalRules];
  const originalRuleNames = new Set(
    originalRules.map((r) => r.name.toLowerCase())
  );

  let addedCount = 0;
  let replacedCount = 0;

  for (const excelRule of keywords) {
    const excelRuleNameLower = (excelRule.name || "").toLowerCase();
    if (!excelRuleNameLower) continue;

    if (originalRuleNames.has(excelRuleNameLower)) {
      const index = mergedRules.findIndex(
        (r) => r.name.toLowerCase() === excelRuleNameLower
      );
      if (index >= 0) {
        mergedRules[index] = excelRule;
        replacedCount++;
      }
    } else {
      mergedRules.push(excelRule);
      addedCount++;
    }
  }

  console.log(
    `✓ Merged rules: ${originalRules.length} original + ${addedCount} new from Excel`
  );
  console.log(`✓ Replaced ${replacedCount} original rules with Excel versions`);
  console.log(`✓ Total rules for analysis: ${mergedRules.length}`);

  return mergedRules;
}

