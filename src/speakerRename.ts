/**
 * Speaker rename — propagate a speaker name change across every layer of the
 * note + wiki data model in one transactional-ish operation.
 *
 * Architectural rationale
 * -----------------------
 * Speaker identity is stored as a string label in 4+ independent places:
 *   1. Note transcript: `[Speaker 0 @sec]:` lines
 *   2. Note summary:    LLM-generated text mentioning the speaker name
 *   3. Meeting index:   `meetingindex.md` row's Brief field can quote labels
 *   4. Wiki entities:   `wiki/people/<slug>.md` (file + heading) plus inline
 *                       mentions in `wiki/{projects,decisions,topics,actions}/*.md`
 *
 * No layer notifies the others on edit. Renaming in the transcript alone is
 * insufficient; the user sees stale names everywhere else. This module is the
 * single coordinator that walks all four layers.
 *
 * Design choices
 * --------------
 * - Surgical text replacement, not LLM re-extraction. Re-running the LLM is
 *   slow, non-deterministic, and would clobber user edits to wiki pages.
 * - Word-boundary regex via `(?<![A-Za-z0-9_])from(?![A-Za-z0-9_])` so
 *   `Speaker 1` does not match `Speaker 10` even though both end in a digit.
 * - People-page rename has two paths: file rename (destination free) or merge
 *   (destination exists — append source under a "## Merged from" section).
 * - Each helper is pure where possible; the wiki walker uses fs and is tested
 *   against a tmp directory.
 * - Idempotent: a second run with the same args is a no-op (counts return 0).
 * - Per-layer counts are returned so the caller can log/show what was touched.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { slugify } from "./wikiCompiler.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NoteRenameResult {
  content: string;
  /** Total per-line/per-token replacements across Transcript + Summary. */
  replaced: number;
}

export interface IndexRenameResult {
  content: string;
  /** Per-token replacements within the matched index row. */
  replaced: number;
}

export interface WikiRenameResult {
  /** Wiki files where one or more text replacements happened. */
  filesUpdated: number;
  /** People pages renamed in place (destination did not exist). */
  peopleRenamed: number;
  /** People pages merged into an existing destination. */
  peopleMerged: number;
  /** Aggregate text-replacement count across the wiki. */
  replacements: number;
}

export interface SpeakerRenameSummary {
  ok: true;
  note: number;
  index: number;
  wiki: WikiRenameResult;
}

// ---------------------------------------------------------------------------
// Word-boundary regex builder
// ---------------------------------------------------------------------------

/**
 * Build a regex matching `from` only as a whole word/token. Uses explicit
 * non-word lookahead/lookbehind so the boundary check works regardless of
 * whether `from` starts/ends with a word or non-word character. Escapes
 * regex metacharacters in `from` so user-supplied names like `Speaker (1)`
 * or `O'Brien` are matched literally.
 *
 * Exported for tests + reuse.
 */
export function buildSpeakerRegex(from: string, flags = "g"): RegExp {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, flags);
}

// ---------------------------------------------------------------------------
// Layer 1+2: Note file (Transcript + Summary)
// ---------------------------------------------------------------------------

/**
 * Rewrite both the `## Transcript` and `## Summary` sections of a meeting
 * note's markdown content. Other sections (frontmatter metadata, additional
 * H2 sections) are left untouched.
 *
 * Transcript replacement is line-anchored: `[<from>(\s+@<sec>)?]:` → `[<to>$1]:`
 * Summary replacement is word-token: any whole-token mention of `<from>`.
 *
 * Returns the rewritten content and total replacement count.
 */
export function renameSpeakerInNoteContent(
  content: string,
  from: string,
  to: string,
): NoteRenameResult {
  if (!from || !to || from === to) return { content, replaced: 0 };

  let updated = content;
  let replaced = 0;

  // --- Transcript section: line-anchored ---
  const transcriptHeader = "## Transcript\n";
  const transcriptStart = updated.indexOf(transcriptHeader);
  if (transcriptStart >= 0) {
    const sectionStart = transcriptStart + transcriptHeader.length;
    const before = updated.slice(0, sectionStart);
    const transcript = updated.slice(sectionStart);
    const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lineRegex = new RegExp(
      `^\\[${escapedFrom}(\\s+@[\\d.]+)?\\]:`,
      "gm",
    );
    const newTranscript = transcript.replace(
      lineRegex,
      (_match, timeSuffix: string | undefined) => {
        replaced += 1;
        return `[${to}${timeSuffix ?? ""}]:`;
      },
    );
    updated = before + newTranscript;
  }

  // --- Summary section: word-token ---
  // The summary section runs from `## Summary\n` until `## Transcript` (the
  // ONLY hard section break — LLM summaries contain nested H2s like
  // `## About Meeting`, `## Meeting Outline` which are part of the summary
  // body, not section breaks). This matches wikiCompiler.extractSummarySection.
  const summaryMatch = updated.match(
    /## Summary\n([\s\S]*?)(?=\n## Transcript\b|$)/,
  );
  if (summaryMatch && summaryMatch.index !== undefined && summaryMatch[1] !== undefined) {
    const sectionStart = summaryMatch.index + "## Summary\n".length;
    const sectionEnd = sectionStart + summaryMatch[1].length;
    const summaryBody = updated.slice(sectionStart, sectionEnd);
    const wordRegex = buildSpeakerRegex(from);
    const newSummary = summaryBody.replace(wordRegex, () => {
      replaced += 1;
      return to;
    });
    if (newSummary !== summaryBody) {
      updated = updated.slice(0, sectionStart) + newSummary + updated.slice(sectionEnd);
    }
  }

  return { content: updated, replaced };
}

// ---------------------------------------------------------------------------
// Layer 3: Meeting index (meetingindex.md / whisperindex.md)
// ---------------------------------------------------------------------------

/**
 * Rewrite the speaker name within the index row whose `Source: <source>` field
 * matches. Word-token match across the whole row, so any field (Title, Brief,
 * Attendee) that mentions the name is updated. Other rows are left untouched.
 */
export function renameSpeakerInIndexContent(
  indexContent: string,
  source: string,
  from: string,
  to: string,
): IndexRenameResult {
  if (!from || !to || from === to) return { content: indexContent, replaced: 0 };
  const lines = indexContent.split("\n");
  const wordRegex = buildSpeakerRegex(from);
  let replaced = 0;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes(`Source: ${source}`)) continue;
    wordRegex.lastIndex = 0;
    const updated = line.replace(wordRegex, () => {
      replaced += 1;
      return to;
    });
    if (updated !== line) {
      lines[i] = updated;
      changed = true;
    }
  }
  return { content: changed ? lines.join("\n") : indexContent, replaced };
}

// ---------------------------------------------------------------------------
// Layer 4: Wiki — file rename/merge + text replacement across all categories
// ---------------------------------------------------------------------------

const WIKI_CATEGORIES = ["people", "projects", "topics", "decisions", "actions"] as const;

/**
 * Rename a speaker across the entire wiki directory.
 *
 * Steps:
 * 1. If `wiki/people/<slug(from)>.md` exists:
 *      - rewrite its `# heading` to `<to>` and any inline mentions
 *      - if `wiki/people/<slug(to)>.md` does NOT exist → write to new path, delete source (rename)
 *      - if it DOES exist → append rewritten content under `## Merged from "<from>"` (merge)
 * 2. Walk every other wiki .md file in every category and replace any
 *    whole-token mention of `from` with `to`.
 *
 * Step 1 must run before step 2 so the source file is gone when the walk happens
 * (the walk skips it explicitly anyway, but this keeps the order deterministic).
 */
export async function renameSpeakerInWikiDir(
  wikiDir: string,
  from: string,
  to: string,
): Promise<WikiRenameResult> {
  const result: WikiRenameResult = {
    filesUpdated: 0,
    peopleRenamed: 0,
    peopleMerged: 0,
    replacements: 0,
  };
  if (!from || !to || from === to) return result;

  const wordRegex = buildSpeakerRegex(from);
  const fromSlug = slugify(from);
  const toSlug = slugify(to);

  // Track files that step 2 must skip — typically the source (gone after
  // rename/merge) and the destination (whose content was already correctly
  // updated in step 1). Skipping the destination is critical because the
  // merge marker line `## Merged from "<from>"` contains the from-name
  // verbatim, which step 2 would otherwise mistakenly rewrite.
  const skipPeopleFiles = new Set<string>();

  // --- Step 1: handle the people page for the old name ---
  if (fromSlug !== toSlug) {
    const peopleDir = path.join(wikiDir, "people");
    const fromPath = path.join(peopleDir, `${fromSlug}.md`);
    const toPath = path.join(peopleDir, `${toSlug}.md`);

    let sourceContent: string | null = null;
    try {
      sourceContent = await fs.readFile(fromPath, "utf8");
    } catch {
      // Source page doesn't exist — nothing special to do for the people page,
      // step 2 will still rewrite mentions in the rest of the wiki.
    }

    if (sourceContent !== null) {
      // Rewrite the heading to the new name
      let rewritten = sourceContent.replace(/^# .+/m, `# ${to}`);
      // Rewrite inline mentions of the old name elsewhere in the body
      let perFileReplacements = 0;
      wordRegex.lastIndex = 0;
      rewritten = rewritten.replace(wordRegex, () => {
        perFileReplacements += 1;
        return to;
      });
      result.replacements += perFileReplacements;

      let destinationExists = false;
      try {
        await fs.access(toPath);
        destinationExists = true;
      } catch {
        /* destination free */
      }

      if (destinationExists) {
        // MERGE: append the rewritten body to the existing destination,
        // preserving any user edits there. Strip the source's leading H1
        // since the destination already has its own.
        const destContent = await fs.readFile(toPath, "utf8");
        const sourceBody = rewritten.replace(/^# .+\n?/m, "").trimStart();
        const merged =
          destContent.trimEnd() +
          `\n\n## Merged from "${from}"\n\n` +
          sourceBody +
          (sourceBody.endsWith("\n") ? "" : "\n");
        await fs.writeFile(toPath, merged, "utf8");
        await fs.unlink(fromPath);
        result.peopleMerged += 1;
      } else {
        // RENAME: write the new path then delete the old
        await fs.writeFile(toPath, rewritten, "utf8");
        await fs.unlink(fromPath);
        result.peopleRenamed += 1;
      }
      // Step 2 must skip both source (gone) and destination (already
      // correctly updated, and contains the merge marker which step 2
      // would otherwise mangle).
      skipPeopleFiles.add(`${fromSlug}.md`);
      skipPeopleFiles.add(`${toSlug}.md`);
    }
  }

  // --- Step 2: walk every other wiki file and rewrite text mentions ---
  for (const category of WIKI_CATEGORIES) {
    const dir = path.join(wikiDir, category);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue; // category dir may not exist yet
    }
    for (const file of entries) {
      if (!file.endsWith(".md")) continue;
      // Skip the people files we already handled in step 1: the source (gone
      // after rename/merge) and the destination (whose merge marker contains
      // the from-name verbatim and must NOT be rewritten).
      if (category === "people" && skipPeopleFiles.has(file)) continue;

      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, "utf8");
      wordRegex.lastIndex = 0;
      if (!wordRegex.test(content)) continue;
      wordRegex.lastIndex = 0;
      let perFileReplacements = 0;
      const updated = content.replace(wordRegex, () => {
        perFileReplacements += 1;
        return to;
      });
      if (perFileReplacements > 0) {
        await fs.writeFile(filePath, updated, "utf8");
        result.filesUpdated += 1;
        result.replacements += perFileReplacements;
      }
    }
  }

  return result;
}
