import { promises as fs } from "node:fs";
import path from "node:path";
import { streamLlmChat } from "./llmChat.js";
import { sanitizeLlmOutput } from "./meetingWorkflow.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIKI_EXTRACTION_PROMPT = "You are a knowledge extraction assistant. Read the meeting summary below and extract structured information.\n\n" +
    "Output a JSON object with these fields:\n" +
    '- people: [{name, role, mentions: ["fact1", "fact2"]}]\n' +
    '- projects: [{name, status, updates: ["update1"]}]\n' +
    '- topics: [{name, content: ["point1", "point2"]}]\n' +
    '- decisions: [{decision, context, participants: ["name1"]}]\n' +
    '- actions: [{action, owner, deadline, status: "open"|"done"}]\n\n' +
    "Rules:\n" +
    "- Only include information EXPLICITLY stated in the summary.\n" +
    "- Use exact names and terminology from the text.\n" +
    "- Each mention/update should be a single sentence.\n" +
    "- If a field is unknown, omit it.\n" +
    "- Output ONLY valid JSON, no explanation, no markdown fences.";
// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function compileWiki(options, newSources) {
    const log = options.log ?? (() => { });
    const host = options.llmHost ?? "http://localhost:8080";
    const model = options.llmModel ?? "mlx-community/Qwen3.5-9B-4bit";
    const wikiDir = path.join(options.storageDir, "wiki");
    // Ensure wiki directory structure
    await ensureWikiDirs(wikiDir);
    // Find meeting notes to compile
    const notePaths = await findNotesToCompile(options.storageDir, newSources);
    if (notePaths.length === 0) {
        log("no new notes to compile");
        return { pagesWritten: 0, pagesUpdated: 0, errors: [] };
    }
    log(`compiling ${notePaths.length} note(s) into wiki`);
    let pagesWritten = 0;
    let pagesUpdated = 0;
    const errors = [];
    for (const notePath of notePaths) {
        try {
            const noteContent = await fs.readFile(notePath, "utf8");
            const summary = extractSummarySection(noteContent);
            if (!summary || summary.length < 20)
                continue;
            const meta = extractNoteMeta(noteContent, notePath);
            const sourceRef = `[src: ${path.basename(notePath)}]`;
            // LLM extraction
            log(`extracting entities from ${path.basename(notePath)}`);
            const extraction = await extractEntities(host, model, summary, meta, sourceRef);
            // Merge into wiki pages
            const result = await mergeIntoWiki(wikiDir, extraction, sourceRef, meta.date);
            pagesWritten += result.written;
            pagesUpdated += result.updated;
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${path.basename(notePath)}: ${msg}`);
            log(`error: ${msg}`);
        }
    }
    // Regenerate master index
    await regenerateIndex(wikiDir);
    log(`wiki compiled: ${pagesWritten} written, ${pagesUpdated} updated`);
    return { pagesWritten, pagesUpdated, errors };
}
// ---------------------------------------------------------------------------
// LLM Extraction
// ---------------------------------------------------------------------------
async function extractEntities(host, model, summary, meta, sourceRef) {
    const userMessage = `Meeting date: ${meta.date}\nAttendees: ${meta.attendee}\nSource: ${meta.source}\n\nSummary:\n${summary.slice(0, 8000)}\n\n/no_think`;
    const rawContent = await streamLlmChat(host, {
        model,
        messages: [
            { role: "system", content: WIKI_EXTRACTION_PROMPT },
            { role: "user", content: userMessage },
        ],
    });
    const cleaned = sanitizeLlmOutput(rawContent);
    return parseExtractionJson(cleaned, sourceRef);
}
export function parseExtractionJson(text, sourceRef) {
    const empty = { people: [], projects: [], topics: [], decisions: [], actions: [] };
    // Find JSON object in text
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch)
        return empty;
    try {
        const obj = JSON.parse(jsonMatch[0]);
        const people = Array.isArray(obj.people)
            ? obj.people.map((p) => ({
                name: String(p.name ?? ""),
                role: p.role ? String(p.role) : undefined,
                mentions: Array.isArray(p.mentions) ? p.mentions.map(String) : [],
                sourceRef,
            })).filter((p) => p.name.length > 0)
            : [];
        const projects = Array.isArray(obj.projects)
            ? obj.projects.map((p) => ({
                name: String(p.name ?? ""),
                status: p.status ? String(p.status) : undefined,
                updates: Array.isArray(p.updates) ? p.updates.map(String) : [],
                sourceRef,
            })).filter((p) => p.name.length > 0)
            : [];
        const topics = Array.isArray(obj.topics)
            ? obj.topics.map((t) => ({
                name: String(t.name ?? ""),
                content: Array.isArray(t.content) ? t.content.map(String) : [],
                sourceRef,
            })).filter((t) => t.name.length > 0)
            : [];
        const decisions = Array.isArray(obj.decisions)
            ? obj.decisions.map((d) => ({
                decision: String(d.decision ?? ""),
                context: d.context ? String(d.context) : undefined,
                participants: Array.isArray(d.participants) ? d.participants.map(String) : [],
                sourceRef,
                date: "",
            })).filter((d) => d.decision.length > 0)
            : [];
        const actions = Array.isArray(obj.actions)
            ? obj.actions.map((a) => ({
                action: String(a.action ?? ""),
                owner: a.owner ? String(a.owner) : undefined,
                deadline: a.deadline ? String(a.deadline) : undefined,
                status: (String(a.status ?? "open") === "done" ? "done" : "open"),
                sourceRef,
            })).filter((a) => a.action.length > 0)
            : [];
        return { people, projects, topics, decisions, actions };
    }
    catch {
        return empty;
    }
}
// ---------------------------------------------------------------------------
// Wiki page merge
// ---------------------------------------------------------------------------
async function mergeIntoWiki(wikiDir, extraction, sourceRef, date) {
    let written = 0;
    let updated = 0;
    // People
    for (const person of extraction.people) {
        const slug = slugify(person.name);
        const filePath = path.join(wikiDir, "people", `${slug}.md`);
        const existed = await fileExists(filePath);
        await mergePersonPage(filePath, person, date);
        if (existed)
            updated++;
        else
            written++;
    }
    // Projects
    for (const project of extraction.projects) {
        const slug = slugify(project.name);
        const filePath = path.join(wikiDir, "projects", `${slug}.md`);
        const existed = await fileExists(filePath);
        await mergeProjectPage(filePath, project, date);
        if (existed)
            updated++;
        else
            written++;
    }
    // Topics
    for (const topic of extraction.topics) {
        const slug = slugify(topic.name);
        const filePath = path.join(wikiDir, "topics", `${slug}.md`);
        const existed = await fileExists(filePath);
        await mergeTopicPage(filePath, topic, date);
        if (existed)
            updated++;
        else
            written++;
    }
    // Decisions — append to monthly log
    if (extraction.decisions.length > 0) {
        const month = date.slice(0, 7); // YYYY-MM
        const filePath = path.join(wikiDir, "decisions", `decisions-${month}.md`);
        const existed = await fileExists(filePath);
        await appendDecisions(filePath, extraction.decisions, date, sourceRef);
        if (existed)
            updated++;
        else
            written++;
    }
    // Actions — append to open actions
    if (extraction.actions.length > 0) {
        const filePath = path.join(wikiDir, "actions", "actions-open.md");
        const existed = await fileExists(filePath);
        await appendActions(filePath, extraction.actions, sourceRef);
        if (existed)
            updated++;
        else
            written++;
    }
    return { written, updated };
}
async function mergePersonPage(filePath, person, date) {
    let content;
    if (await fileExists(filePath)) {
        content = await fs.readFile(filePath, "utf8");
        // Append new mentions (skip duplicates by sourceRef)
        for (const mention of person.mentions) {
            const entry = `- ${mention} ${person.sourceRef}`;
            if (!content.includes(person.sourceRef)) {
                content = appendToSection(content, "Key Facts", entry);
            }
        }
        // Update meeting history
        const historyEntry = `- ${date}: ${person.mentions[0] ?? "Mentioned"} ${person.sourceRef}`;
        if (!content.includes(person.sourceRef)) {
            content = appendToSection(content, "Meeting History", historyEntry);
        }
        // Update last seen
        content = content.replace(/- Last seen: .+/, `- Last seen: ${date}`);
    }
    else {
        const lines = [
            `# ${person.name}`,
            "",
            ...(person.role ? [`- Role: ${person.role}`] : []),
            `- Last seen: ${date}`,
            "",
            "## Key Facts",
            ...person.mentions.map((m) => `- ${m} ${person.sourceRef}`),
            "",
            "## Meeting History",
            `- ${date}: ${person.mentions[0] ?? "Mentioned"} ${person.sourceRef}`,
            "",
        ];
        content = lines.join("\n");
    }
    await fs.writeFile(filePath, content, "utf8");
}
async function mergeProjectPage(filePath, project, date) {
    let content;
    if (await fileExists(filePath)) {
        content = await fs.readFile(filePath, "utf8");
        for (const update of project.updates) {
            const entry = `- ${date}: ${update} ${project.sourceRef}`;
            if (!content.includes(project.sourceRef)) {
                content = appendToSection(content, "Updates", entry);
            }
        }
        if (project.status) {
            content = content.replace(/- Status: .+/, `- Status: ${project.status}`);
        }
        content = content.replace(/- Last updated: .+/, `- Last updated: ${date}`);
    }
    else {
        const lines = [
            `# ${project.name}`,
            "",
            ...(project.status ? [`- Status: ${project.status}`] : []),
            `- Last updated: ${date}`,
            "",
            "## Updates",
            ...project.updates.map((u) => `- ${date}: ${u} ${project.sourceRef}`),
            "",
        ];
        content = lines.join("\n");
    }
    await fs.writeFile(filePath, content, "utf8");
}
async function mergeTopicPage(filePath, topic, date) {
    let content;
    if (await fileExists(filePath)) {
        content = await fs.readFile(filePath, "utf8");
        for (const point of topic.content) {
            const entry = `- ${point} ${topic.sourceRef}`;
            if (!content.includes(topic.sourceRef)) {
                content = appendToSection(content, "Notes", entry);
            }
        }
    }
    else {
        const lines = [
            `# ${topic.name}`,
            "",
            `- Last updated: ${date}`,
            "",
            "## Notes",
            ...topic.content.map((c) => `- ${c} ${topic.sourceRef}`),
            "",
        ];
        content = lines.join("\n");
    }
    await fs.writeFile(filePath, content, "utf8");
}
async function appendDecisions(filePath, decisions, date, sourceRef) {
    let content = "";
    if (await fileExists(filePath)) {
        content = await fs.readFile(filePath, "utf8");
    }
    else {
        content = `# Decisions — ${date.slice(0, 7)}\n\n`;
    }
    for (const d of decisions) {
        if (content.includes(sourceRef) && content.includes(d.decision.slice(0, 40)))
            continue;
        const participants = d.participants.length > 0 ? ` [${d.participants.join(", ")}]` : "";
        content += `- ${date}: ${d.decision}${participants} ${sourceRef}\n`;
    }
    await fs.writeFile(filePath, content, "utf8");
}
async function appendActions(filePath, actions, sourceRef) {
    let content = "";
    if (await fileExists(filePath)) {
        content = await fs.readFile(filePath, "utf8");
    }
    else {
        content = "# Open Actions\n\n";
    }
    for (const a of actions) {
        if (content.includes(sourceRef) && content.includes(a.action.slice(0, 40)))
            continue;
        const owner = a.owner ? `${a.owner}: ` : "";
        const deadline = a.deadline ? ` [due ${a.deadline}]` : "";
        const checkbox = a.status === "done" ? "[x]" : "[ ]";
        content += `- ${checkbox} ${owner}${a.action}${deadline} ${sourceRef}\n`;
    }
    await fs.writeFile(filePath, content, "utf8");
}
// ---------------------------------------------------------------------------
// Index generation
// ---------------------------------------------------------------------------
export async function regenerateIndex(wikiDir) {
    const categories = ["people", "projects", "topics", "decisions", "actions"];
    const lines = ["# HiDock Wiki", `> Updated: ${new Date().toISOString().slice(0, 10)}`, ""];
    for (const category of categories) {
        const dir = path.join(wikiDir, category);
        let files = [];
        try {
            files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
        }
        catch {
            continue;
        }
        const title = category.charAt(0).toUpperCase() + category.slice(1);
        lines.push(`## ${title} (${files.length})`);
        for (const file of files) {
            const content = await fs.readFile(path.join(dir, file), "utf8");
            const heading = content.match(/^# (.+)/m)?.[1] ?? file.replace(/\.md$/, "");
            const snippet = content.split("\n").find((l) => l.startsWith("- "))?.slice(2, 80) ?? "";
            lines.push(`- [${heading}](${category}/${file}) — ${snippet}`);
        }
        lines.push("");
    }
    await fs.writeFile(path.join(wikiDir, "index.md"), lines.join("\n"), "utf8");
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function ensureWikiDirs(wikiDir) {
    for (const sub of ["people", "projects", "topics", "decisions", "actions"]) {
        await fs.mkdir(path.join(wikiDir, sub), { recursive: true });
    }
}
async function findNotesToCompile(storageDir, newSources) {
    if (!newSources || newSources.length === 0)
        return [];
    const indexPath = path.join(storageDir, "meetingindex.md");
    let indexContent;
    try {
        indexContent = await fs.readFile(indexPath, "utf8");
    }
    catch {
        return [];
    }
    const paths = [];
    for (const source of newSources) {
        // Find the note path from index for this source
        const line = indexContent.split("\n").find((l) => l.includes(`Source: ${source}`));
        if (!line)
            continue;
        const noteMatch = /Note: (.+)$/.exec(line);
        if (noteMatch?.[1]) {
            paths.push(path.join(storageDir, noteMatch[1].trim()));
        }
    }
    return paths;
}
function extractSummarySection(noteContent) {
    const match = noteContent.match(/## Summary\n([\s\S]*?)(?=\n## Transcript\b|$)/);
    return match?.[1]?.trim() ?? "";
}
function extractNoteMeta(noteContent, notePath) {
    const dateMatch = noteContent.match(/- DateTime: (.+)/);
    const attendeeMatch = noteContent.match(/- Attendee: (.+)/);
    const sourceMatch = noteContent.match(/- Source: (.+)/);
    return {
        date: dateMatch?.[1]?.trim() ?? new Date().toISOString().slice(0, 10),
        attendee: attendeeMatch?.[1]?.trim() ?? "Unknown",
        source: sourceMatch?.[1]?.trim() ?? path.basename(notePath),
    };
}
export function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff\uac00-\ud7af]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "unnamed";
}
function appendToSection(content, sectionName, entry) {
    const sectionRegex = new RegExp(`(## ${sectionName}\n)`, "m");
    const match = sectionRegex.exec(content);
    if (match) {
        const insertPos = match.index + match[0].length;
        return content.slice(0, insertPos) + entry + "\n" + content.slice(insertPos);
    }
    // Section doesn't exist — append it
    return content.trimEnd() + `\n\n## ${sectionName}\n${entry}\n`;
}
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=wikiCompiler.js.map