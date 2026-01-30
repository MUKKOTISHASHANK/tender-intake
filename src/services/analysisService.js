import { NI, GAP_CATEGORIES } from "../utils/constants.js";
import { norm, rxFind, splitIntoSections, inText, missingTerms } from "../utils/textUtils.js";
import { readDocumentText } from "./documentService.js";
import {
  loadKeywordsFromExcel,
  buildRulesFromKeywords,
} from "./keywordRulesService.js";
import {
  extractDocumentInfoWithAI,
  enhanceRecommendationsWithAI,
} from "./aiService.js";

function initCategories() {
  return Object.fromEntries(GAP_CATEGORIES.map((k) => [k, []]));
}

function bestTitleCandidate(lines) {
  const titleSignals = /(rfp|request for proposal|sap|s4|s\/4|implementation|tender)/i;
  const clean = lines.map((x) => norm(x)).filter(Boolean);

  const strong = clean.find((x) => titleSignals.test(x) && x.length >= 15);
  if (strong) return strong;

  return clean.find((x) => x.length >= 10) || null;
}

function extractYear(text) {
  const extractYearFromMatch = (match) => {
    if (!match) return null;
    if (typeof match === "string" && /^20\d{2}$/.test(match.trim())) {
      const year = parseInt(match.trim(), 10);
      if (year >= 2000 && year <= 2099) return year;
    }
    const yearMatch =
      typeof match === "string" ? match.match(/(20\d{2})/) : null;
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (year >= 2000 && year <= 2099) return year;
    }
    return null;
  };

  const patterns = [
    String.raw`Date\s+of\s+issue[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Issue\s+Date[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Issued\s+on[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Date[:\s]*[^\n]{0,50}?[0-9]{1,2}[/\-\.][0-9]{1,2}[/\-\.](20\d{2})`,
    String.raw`Reference\s+ID[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`Ref[.\s]+ID[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`RFP[.\s]+No[.\s]*[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`Reference\s+Number[:\s]*[^\n]{0,150}?[/\-](20\d{2})`,
    String.raw`(20\d{2})\s*(?:RFP|Request|Proposal)`,
    String.raw`(?:RFP|Request|Proposal)\s*(20\d{2})`,
    String.raw`(?:issue|issued|issue\s+date|date\s+of\s+issue)[^\n]{0,100}?(20\d{2})`,
    String.raw`(20\d{2})[^\n]{0,50}?(?:issue|issued|date)`,
  ];

  for (const pattern of patterns) {
    const match = rxFind(text, pattern, "i");
    const year = extractYearFromMatch(match);
    if (year) return year;
  }

  const earlyYear = rxFind(text, String.raw`^[\s\S]{0,1000}?(20\d{2})`, "i");
  const year = extractYearFromMatch(earlyYear);
  if (year) return year;

  return null;
}

async function extractDocumentInfo(text, providedDepartment = null) {
  let aiInfo = null;
  aiInfo = await extractDocumentInfoWithAI(text);

  let title = null;
  const titlePatterns = [
    String.raw`Document\s+Title[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`Title[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`Request\s+for\s+Proposal[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`RFP[:\s]*[\r\n]+([^\r\n]{10,200})`,
    String.raw`^([A-Z][^\r\n]{20,150}(?:SAP|S4|S\/4|Implementation|RFP|Tender)[^\r\n]{0,100})`,
  ];

  for (const pattern of titlePatterns) {
    const match = rxFind(text, pattern, "im");
    if (match) {
      const candidate = bestTitleCandidate([match]);
      if (candidate && candidate.length >= 15) {
        title = candidate;
        break;
      }
    }
  }

  if (!title) {
    const firstLines = text
      .split("\n")
      .slice(0, 10)
      .map(norm)
      .filter((l) => l.length >= 15);
    title = bestTitleCandidate(firstLines);
  }

  let department = providedDepartment || null;
  if (!department) {
    const deptPatterns = [
      String.raw`Name\s+of\s+the\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Issuing\s+Organization[:\s]*[\r\n]+([^\r\n]{5,150})`,
      String.raw`Department[:\s]*[\r\n]+([^\r\n]{5,150})`,
    ];

    for (const pattern of deptPatterns) {
      const match = rxFind(text, pattern, "i");
      if (match) {
        const cleaned = norm(match);
        if (cleaned.length >= 5 && cleaned.length <= 150) {
          department = cleaned;
          break;
        }
      }
    }

    if (/Public\s+Services\s+Department/i.test(text)) {
      department = "Public Services Department";
    } else if (!department && /PSD/i.test(text)) {
      department = "Public Services Department";
    }
  }

  let docType = /\bRFP\b|Request\s+for\s+Proposal/i.test(text) ? "RFP" : NI;

  let refId = null;
  const refIdPatterns = [
    String.raw`Reference\s+ID[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Ref[.\s]+ID[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`RFP[.\s]+No[.\s]*[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Reference\s+Number[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
    String.raw`Document\s+Reference[:\s]*[\r\n]+?\s*([A-Za-z0-9\-/]+)`,
  ];

  for (const pattern of refIdPatterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      refId = norm(match);
      if (refId.length >= 3) break;
    }
  }

  let version = null;
  const versionPatterns = [
    String.raw`Version\s+No[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`Version[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`Ver[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
    String.raw`V[.\s]*[:\s]*[\r\n]+?\s*([0-9.]+)`,
  ];

  for (const pattern of versionPatterns) {
    const match = rxFind(text, pattern, "i");
    if (match) {
      version = norm(match);
      if (version.length >= 1) break;
    }
  }

  const notes = [];
  if (refId) notes.push(`Reference ID: ${refId}`);
  if (version) notes.push(`Version: ${version}`);

  let year = extractYear(text);

  if (aiInfo) {
    if (!title || title === NI) {
      title = aiInfo.title;
    } else if (
      aiInfo.title &&
      aiInfo.title !== title &&
      aiInfo.title.length > title.length
    ) {
      title = aiInfo.title;
    }

    if (!department || department === NI) {
      department = aiInfo.department;
    } else if (aiInfo.department && aiInfo.department.length > department.length) {
      department = aiInfo.department;
    }

    if (docType === NI && aiInfo.documentType) {
      docType = aiInfo.documentType;
    }

    if ((year === null || year === NI) && aiInfo.year) {
      year = aiInfo.year;
    }

    if (!refId && aiInfo.referenceId) {
      refId = aiInfo.referenceId;
      if (!notes.some((n) => n.includes("Reference ID"))) {
        notes.push(`Reference ID: ${refId}`);
      }
    }

    if (!version && aiInfo.version) {
      version = aiInfo.version;
      if (!notes.some((n) => n.includes("Version"))) {
        notes.push(`Version: ${version}`);
      }
    }
  }

  return {
    title: title ? norm(title) : NI,
    department: department ? norm(department) : NI,
    documentType: docType,
    year: year ?? NI,
    notes: notes.length ? notes.join("; ") : NI,
  };
}

export async function analyze(
  filePath,
  providedDepartment = null,
  providedCategory = null,
  originalFileName = null
) {
  const text = await readDocumentText(filePath, originalFileName);
  const sections = splitIntoSections(text);

  const documentInfo = await extractDocumentInfo(text, providedDepartment);
  if (providedDepartment) {
    documentInfo.department = providedDepartment;
  }

  const gapCategories = initCategories();
  const recommendations = initCategories();

  const missingSections = [];
  const weakSections = [];
  const unclearSections = [];
  const outdatedContent = [];

  const keywords = loadKeywordsFromExcel();
  const rules = buildRulesFromKeywords(keywords);

  let filteredRules = rules;
  if (providedCategory) {
    const normalizedCategory = providedCategory.trim();
    const validGapCategories = GAP_CATEGORIES.map((c) => c.toLowerCase());
    const isValidGapCategory = validGapCategories.includes(
      normalizedCategory.toLowerCase()
    );

    if (isValidGapCategory) {
      filteredRules = rules.filter(
        (r) => r.category.toLowerCase() === normalizedCategory.toLowerCase()
      );
      console.log(
        `Filtered to ${filteredRules.length} rules for gap category: ${normalizedCategory}`
      );
      if (filteredRules.length === 0) {
        console.warn(
          `No rules found for gap category: ${normalizedCategory}, using all rules`
        );
        filteredRules = rules;
      }
    } else {
      console.warn(
        `Provided category "${providedCategory}" is not a valid gap category. Valid gap categories are: ${GAP_CATEGORIES.join(
          ", "
        )}. Using all rules.`
      );
      filteredRules = rules;
    }
  }

  console.log(
    `Using ${filteredRules.length} rules for analysis (total available: ${rules.length})`
  );

  function getScopeText(rule) {
    const chunks = [];
    for (const sec of rule.where || []) {
      if (sections[sec]) chunks.push(sections[sec]);
    }
    return chunks.length ? chunks.join("\n") : sections.FULL || text;
  }

  for (const r of filteredRules) {
    const scope = getScopeText(r);
    const present = inText(scope, r.presence || []);

    if (r.required && !present) {
      missingSections.push(r.name);
      gapCategories[r.category].push(`Missing: ${r.name}`);
      recommendations[r.category].push(
        `Add a complete section for '${r.name}' aligned to PSD/government tender norms.`
      );
      continue;
    }

    if (present) {
      if (r.quality_requires?.length) {
        const miss = missingTerms(scope, r.quality_requires);
        if (miss.length) {
          weakSections.push(`${r.name} lacks detail: ${miss.join(", ")}`);
          gapCategories[r.category].push(
            `Weak: ${r.name} lacks measurable detail (${miss.join(", ")}).`
          );
          recommendations[r.category].push(
            `Strengthen '${r.name}' by explicitly defining: ${miss.join(", ")}.`
          );
        }
      }

      if (r.unclear_triggers?.length && inText(scope, r.unclear_triggers)) {
        const hits = r.unclear_triggers.filter((p) =>
          new RegExp(p, "i").test(scope)
        );
        unclearSections.push(
          `${r.name} contains ambiguous phrasing (${hits.join(", ")})`
        );
        gapCategories[r.category].push(
          `Unclear: ${r.name} contains ambiguous phrasing (${hits.join(", ")}).`
        );
        recommendations[r.category].push(
          `Clarify '${r.name}' by replacing ambiguous phrases with specific, testable requirements.`
        );
      }

      if (r.outdated_triggers?.length) {
        for (const p of r.outdated_triggers) {
          if (new RegExp(p, "i").test(scope)) {
            const msg = `Outdated reference in '${r.name}': ${p}`;
            if (!outdatedContent.includes(msg)) outdatedContent.push(msg);
            gapCategories[r.category].push(`Outdated: ${msg}`);
            recommendations[r.category].push(
              `Update '${r.name}' to remove legacy references and align to current government enterprise standards.`
            );
          }
        }
      }
    }
  }

  const headerDeadline = rxFind(
    text,
    String.raw`Proposal Submission Deadline\s*[\r\n]+?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})`
  );
  const tableDeadline = rxFind(
    text,
    String.raw`Submission of Technical and Commercial Proposal\s*[\r\n]+?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})`
  );
  if (headerDeadline && tableDeadline && headerDeadline !== tableDeadline) {
    unclearSections.push(
      `Contradictory proposal submission deadlines: ${headerDeadline} vs ${tableDeadline}`
    );
    gapCategories["Administrative"].push(
      `Unclear: Contradictory proposal submission deadlines (${headerDeadline} vs ${tableDeadline}).`
    );
    recommendations["Administrative"].push(
      "Resolve conflicting submission deadlines by issuing an addendum that states one authoritative deadline (date + time + timezone)."
    );
  }

  if (!/\bKPI\b|Key Performance|scorecard|OKR/i.test(text)) {
    missingSections.push(
      "Specific metrics for evaluating vendor performance post-implementation"
    );
    gapCategories["KPI & Performance"].push(
      "Missing: Specific metrics for evaluating vendor performance post-implementation."
    );
    recommendations["KPI & Performance"].push(
      "Add a KPI/benefits-realization section covering baseline, targets, measurement cadence, and vendor accountability post go-live."
    );
  }

  if (/risk/i.test(text) && !/risk scoring|risk register|probability|impact/i.test(text)) {
    weakSections.push(
      "Risk management is mentioned but lacks formal scoring/register (probability × impact)."
    );
    gapCategories["Risk Management"].push(
      "Weak: Risk management is mentioned but lacks a formal risk scoring model and risk register."
    );
    recommendations["Risk Management"].push(
      "Add a formal risk register with probability/impact scoring, mitigation owners, review cadence, and escalation thresholds."
    );
  }

  function computeScore() {
    if (missingSections.length) return 32;
    if (outdatedContent.length) return 52;
    if (unclearSections.length) return 62;
    if (weakSections.length) return 72;
    return 90;
  }

  const overallScore = computeScore();
  const summary =
    missingSections.length ||
    weakSections.length ||
    unclearSections.length ||
    outdatedContent.length
      ? "The document contains gaps and/or weaknesses against typical government ICT transformation tender standards, notably around KPI/performance accountability, clarity of administrative dates, and modernization of legacy references."
      : "The document appears broadly complete against common government ICT tender best practices.";

  const high = [];
  const med = [];
  const low = [];

  if ([...unclearSections, ...missingSections].some((x) => /integration/i.test(x))) {
    high.push(
      "Unclear integration requirements could lead to project failure and vendor misalignment."
    );
  }
  if ([...weakSections, ...missingSections].some((x) => /SLA|Support/i.test(x))) {
    high.push(
      "Weak SLA/support definition may cause low performance and uncontrolled operational costs."
    );
  }
  if ([...weakSections, ...missingSections].some((x) => /security/i.test(x))) {
    high.push(
      "Insufficient security requirements increase cybersecurity and compliance risk."
    );
  }

  if (unclearSections.some((x) => /Contradictory/i.test(x))) {
    med.push(
      "Administrative contradictions (submission deadlines) may cause procurement disputes or unfairness claims."
    );
  }
  if ([...weakSections, ...missingSections].some((x) => /Risk management/i.test(x))) {
    med.push(
      "Weak risk governance can reduce delivery predictability and oversight quality."
    );
  }
  if (missingSections.length) {
    med.push(
      "Missing standard tender modules can lead to inconsistent vendor proposals and evaluation difficulty."
    );
  }

  if (outdatedContent.length) {
    low.push(
      "Legacy technology references may misalign solution assumptions with current enterprise baselines."
    );
  }

  const finalize = (arr) => (arr.length ? arr : [NI]);

  let enhancedRecommendations = recommendations;
  const totalRecsBefore = Object.values(recommendations).reduce(
    (sum, recs) => sum + recs.length,
    0
  );

  if (totalRecsBefore > 0) {
    console.log(
      `🤖 Enhancing ${totalRecsBefore} recommendations with AI validation...`
    );
    try {
      enhancedRecommendations = await enhanceRecommendationsWithAI(
        recommendations,
        gapCategories,
        documentInfo
      );
      const totalRecsAfter = Object.values(enhancedRecommendations).reduce(
        (sum, recs) => sum + recs.length,
        0
      );
      console.log(`✓ AI enhancement complete. ${totalRecsAfter} recommendations ready.`);
    } catch (error) {
      console.error(
        `⚠ AI enhancement failed: ${error.message}. Using original recommendations.`
      );
    }
  }

  const totalGaps = Object.values(gapCategories).reduce(
    (sum, gaps) => sum + gaps.length,
    0
  );
  const totalRecs = Object.values(enhancedRecommendations).reduce(
    (sum, recs) => sum + recs.length,
    0
  );
  console.log("\n📊 Analysis Summary:");
  console.log(`   Overall Score: ${overallScore}/100`);
  console.log(`   Total Gaps Found: ${totalGaps}`);
  console.log(`   Total Recommendations: ${totalRecs}`);
  console.log(`   Missing Sections: ${missingSections.length}`);
  console.log(`   Weak Sections: ${weakSections.length}`);
  console.log(`   Unclear Sections: ${unclearSections.length}`);
  console.log(`   Outdated Content: ${outdatedContent.length}\n`);

  return {
    documentInfo,
    completenessAssessment: {
      overallScore,
      summary,
      missingSections: missingSections.length ? missingSections : [NI],
      weakSections: weakSections.length ? weakSections : [NI],
      unclearSections: unclearSections.length ? unclearSections : [NI],
      outdatedContent: outdatedContent.length ? outdatedContent : [NI],
    },
    gapCategories,
    criticalRisks: {
      highImpactRisks: finalize(high),
      mediumImpactRisks: finalize(med),
      lowImpactRisks: finalize(low),
    },
    recommendations: enhancedRecommendations,
  };
}

