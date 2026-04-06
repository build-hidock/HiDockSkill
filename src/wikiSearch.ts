import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchDocument {
  path: string;
  category: string;
  title: string;
  content: string;
  terms: string[];
}

export interface SearchResult {
  path: string;
  category: string;
  title: string;
  score: number;
  snippet: string;
}

export interface WikiSearchIndex {
  documents: SearchDocument[];
  avgDocLength: number;
  termDocFreq: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "be", "as", "was", "are",
  "were", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "shall", "can",
  "this", "that", "these", "those", "i", "you", "he", "she", "we",
  "they", "me", "him", "her", "us", "them", "my", "your", "his",
  "its", "our", "their", "what", "which", "who", "when", "where",
  "how", "not", "no", "if", "then", "than", "so", "up", "out",
  "about", "into", "over", "after", "before", "between", "under",
  "above", "below", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "only", "same", "also", "just",
  "because", "through", "during", "very", "too", "any",
  "src", "md", "meeting", "meetings",
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Latin words
  for (const match of text.toLowerCase().matchAll(/[a-z0-9]{2,}/g)) {
    const word = match[0];
    if (!STOP_WORDS.has(word)) tokens.push(word);
  }
  // CJK characters — bigrams
  for (const match of text.matchAll(/[\u4e00-\u9fff\uac00-\ud7af]{2}/g)) {
    tokens.push(match[0]);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

export async function buildSearchIndex(wikiDir: string): Promise<WikiSearchIndex> {
  const documents: SearchDocument[] = [];
  const categories = ["people", "projects", "topics", "decisions", "actions"];

  for (const category of categories) {
    const dir = path.join(wikiDir, category);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, "utf8");
      const title = content.match(/^# (.+)/m)?.[1] ?? file.replace(/\.md$/, "");
      const terms = tokenize(content);

      documents.push({
        path: `${category}/${file}`,
        category,
        title,
        content,
        terms,
      });
    }
  }

  // Also index the master index
  try {
    const indexContent = await fs.readFile(path.join(wikiDir, "index.md"), "utf8");
    documents.push({
      path: "index.md",
      category: "index",
      title: "Wiki Index",
      content: indexContent,
      terms: tokenize(indexContent),
    });
  } catch { /* no index yet */ }

  // Build term document frequency
  const termDocFreq = new Map<string, number>();
  for (const doc of documents) {
    const uniqueTerms = new Set(doc.terms);
    for (const term of uniqueTerms) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    }
  }

  const totalLength = documents.reduce((sum, d) => sum + d.terms.length, 0);
  const avgDocLength = documents.length > 0 ? totalLength / documents.length : 0;

  return { documents, avgDocLength, termDocFreq };
}

// ---------------------------------------------------------------------------
// BM25 search
// ---------------------------------------------------------------------------

export function searchWiki(
  index: WikiSearchIndex,
  query: string,
  maxResults = 10,
): SearchResult[] {
  if (index.documents.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const k1 = 1.5;
  const b = 0.75;
  const docCount = index.documents.length;

  const results: SearchResult[] = [];

  for (const doc of index.documents) {
    // Build term frequency for this document
    const termFreq = new Map<string, number>();
    for (const t of doc.terms) {
      termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const df = index.termDocFreq.get(term) ?? 0;
      const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.terms.length / index.avgDocLength));
      score += idf * tfNorm;
    }

    if (score > 0) {
      results.push({
        path: doc.path,
        category: doc.category,
        title: doc.title,
        score,
        snippet: extractSnippet(doc.content, queryTerms),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

function extractSnippet(content: string, queryTerms: string[]): string {
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length === 0) return "";

  // Find the line with the most query term matches
  let bestLine = lines[0] ?? "";
  let bestScore = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (lower.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  // Trim to ~200 chars
  return bestLine.length > 200 ? bestLine.slice(0, 200) + "..." : bestLine;
}
