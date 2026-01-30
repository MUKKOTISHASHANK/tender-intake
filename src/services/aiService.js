import { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_ENABLED } from "../config/ollamaConfig.js";
import { rxFind } from "../utils/textUtils.js";

export async function callOllama(prompt, maxRetries = 2) {
  if (!OLLAMA_ENABLED) {
    return null;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${OLLAMA_URL}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response?.trim() || null;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(
          `Warning: Ollama API call failed after ${maxRetries} attempts: ${error.message}`
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return null;
}

export async function extractDocumentInfoWithAI(text) {
  if (!OLLAMA_ENABLED) return null;

  const prompt = `Extract the following information from this RFP/tender document. Return ONLY a JSON object with these exact keys: title, department, documentType, year, referenceId, version. If any field cannot be found, use null.

Document text (first 3000 characters):
${text.substring(0, 3000)}

Return only valid JSON, no explanations:
{
  "title": "...",
  "department": "...",
  "documentType": "RFP" or null,
  "year": 2024 or null,
  "referenceId": "..." or null,
  "version": "..." or null
}`;

  try {
    const response = await callOllama(prompt);
    if (!response) return null;

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || null,
        department: parsed.department || null,
        documentType: parsed.documentType || null,
        year: parsed.year || null,
        referenceId: parsed.referenceId || null,
        version: parsed.version || null,
      };
    }
  } catch (error) {
    console.error(`Warning: AI extraction failed: ${error.message}`);
  }

  return null;
}

export async function enhanceRecommendationsWithAI(
  recommendations,
  gapCategories,
  documentInfo
) {
  if (!OLLAMA_ENABLED) return recommendations;

  const categoriesWithRecs = Object.entries(recommendations).filter(
    ([_, recs]) => recs.length > 0
  );

  if (categoriesWithRecs.length === 0) return recommendations;

  const enhanced = { ...recommendations };

  for (const [category, recs] of categoriesWithRecs) {
    if (recs.length === 0) continue;

    const gaps = gapCategories[category] || [];
    if (gaps.length === 0) continue;

    const prompt = `You are an expert in government ICT tender analysis. Review and improve the following recommendations for a tender document.

Document: ${documentInfo.title || "RFP Document"}
Category: ${category}

Current Gaps:
${gaps.join("\n")}

Current Recommendations:
${recs.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Improve these recommendations to be:
- More specific and actionable
- Aligned with government procurement best practices
- Clear and professional

Return ONLY a JSON array with the same number of improved recommendations, no explanations:
["improved recommendation 1", "improved recommendation 2", ...]`;

    try {
      const response = await callOllama(prompt);
      if (response) {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const improved = JSON.parse(jsonMatch[0]);
          if (Array.isArray(improved) && improved.length === recs.length) {
            enhanced[category] = improved.filter(
              (r) => typeof r === "string" && r.length > 0
            );
            continue;
          }
        }
      }
    } catch (error) {
      console.error(
        `Warning: AI enhancement failed for ${category}: ${error.message}`
      );
    }
  }

  return enhanced;
}

