import { SECTION_HEADERS } from "./constants.js";

export function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function rxFind(text, pattern, flags = "i") {
  const re = new RegExp(pattern, flags);
  const m = text.match(re);
  if (!m) return null;
  return m[1] ?? m[0];
}

export function splitIntoSections(text) {
  const headerRegex = new RegExp(
    `^(${SECTION_HEADERS.map((h) =>
      h.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")
    ).join("|")})\\s*$`,
    "gmi"
  );

  const matches = [...text.matchAll(headerRegex)];
  if (!matches.length) return { FULL: text };

  const sections = {};
  for (let i = 0; i < matches.length; i++) {
    const name = norm(matches[i][1]);
    const start = matches[i].index ?? 0;
    const end =
      i + 1 < matches.length
        ? matches[i + 1].index ?? text.length
        : text.length;
    sections[name] = text.slice(start, end).trim();
  }
  sections.FULL = text;
  return sections;
}

export function inText(text, patterns) {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

export function missingTerms(text, requiredPatterns) {
  return requiredPatterns.filter((p) => !new RegExp(p, "i").test(text));
}

