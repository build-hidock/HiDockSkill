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
/**
 * Build a regex matching `from` only as a whole word/token. Uses explicit
 * non-word lookahead/lookbehind so the boundary check works regardless of
 * whether `from` starts/ends with a word or non-word character. Escapes
 * regex metacharacters in `from` so user-supplied names like `Speaker (1)`
 * or `O'Brien` are matched literally.
 *
 * Exported for tests + reuse.
 */
export declare function buildSpeakerRegex(from: string, flags?: string): RegExp;
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
export declare function renameSpeakerInNoteContent(content: string, from: string, to: string): NoteRenameResult;
/**
 * Rewrite the speaker name within the index row whose `Source: <source>` field
 * matches. Word-token match across the whole row, so any field (Title, Brief,
 * Attendee) that mentions the name is updated. Other rows are left untouched.
 */
export declare function renameSpeakerInIndexContent(indexContent: string, source: string, from: string, to: string): IndexRenameResult;
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
export declare function renameSpeakerInWikiDir(wikiDir: string, from: string, to: string): Promise<WikiRenameResult>;
//# sourceMappingURL=speakerRename.d.ts.map