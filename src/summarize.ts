import { labelsFor } from "./labels.ts";
import { generateJson, withOllama } from "./ollama.ts";
import { renderTurns } from "./transcript.ts";
import type { Transcript, Turn } from "./transcript.ts";

export const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";

export interface ActionItem {
  /** Empty when the transcript does not say who is responsible. */
  owner: string;
  task: string;
  /** Empty when no date was mentioned. */
  due: string;
}

export interface Notes {
  title: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
}

export interface SummarizeOptions {
  model?: string;
  /** Longer transcripts are summarized in parts and then merged. */
  maxChunkChars?: number;
  log?: (message: string) => void;
}

/** About 25 minutes of conversation: small models lose detail on longer inputs. */
const DEFAULT_MAX_CHUNK_CHARS = 30_000;
const MAX_CONTEXT_TOKENS = 32_768;
/** Room for the instructions and the answer on top of the transcript. */
const RESERVED_TOKENS = 4_096;
/** Conservative: Spanish and English average 3 to 4 characters per token. */
const CHARS_PER_TOKEN = 2.8;

const stringList = { type: "array", items: { type: "string" } };
const NOTES_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    keyPoints: stringList,
    decisions: stringList,
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          owner: { type: "string" },
          task: { type: "string" },
          due: { type: "string" },
        },
        required: ["owner", "task", "due"],
      },
    },
    openQuestions: stringList,
  },
  required: ["title", "summary", "keyPoints", "decisions", "actionItems", "openQuestions"],
};

/** Writes meeting notes from a transcript using a local model. */
export async function summarize(transcript: Transcript, options: SummarizeOptions = {}): Promise<Notes> {
  const model = options.model ?? DEFAULT_MODEL;
  const log = options.log ?? (() => {});
  const chunks = chunkTurns(transcript.turns, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
  if (chunks.length === 0) {
    return { title: "", summary: "", keyPoints: [], decisions: [], actionItems: [], openQuestions: [] };
  }

  const ask = async (system: string, user: string): Promise<Notes> => {
    const contextSize = contextSizeFor(system.length + user.length);
    const { value, promptTokens } = await generateJson<Partial<Notes>>({
      model,
      system,
      user,
      schema: NOTES_SCHEMA,
      contextSize,
    });
    if (promptTokens + RESERVED_TOKENS / 2 > contextSize) {
      log("Warning: the transcript nearly filled the model's context; the notes may miss details.");
    }
    return normalize(value);
  };

  return withOllama(async () => {
    const system = systemPrompt(transcript.language);
    if (chunks.length === 1) {
      log(`Writing notes with ${model}...`);
      return ask(system, `Transcript:\n\n${promptText(chunks[0], transcript.language)}`);
    }

    const partial: Notes[] = [];
    for (const [index, chunk] of chunks.entries()) {
      log(`Writing notes with ${model}: part ${index + 1} of ${chunks.length}...`);
      partial.push(
        await ask(system, `This is part ${index + 1} of ${chunks.length} of the transcript:\n\n${promptText(chunk, transcript.language)}`),
      );
    }
    log("Merging the parts...");
    return ask(
      `${system}

You are given notes taken on consecutive parts of one meeting, in order, as JSON.
Merge them into a single set of notes for the whole meeting: combine the summaries,
remove duplicates, and drop a question or task when a later part resolves it.`,
      JSON.stringify(partial, null, 1),
    );
  });
}

/** Splits the conversation into consecutive pieces of at most `maxChars` of text. */
export function chunkTurns(turns: Turn[], maxChars: number): Turn[][] {
  const chunks: Turn[][] = [];
  let size = 0;
  for (const turn of turns) {
    const length = turn.text.length + 10;
    if (chunks.length === 0 || (size + length > maxChars && size > 0)) {
      chunks.push([]);
      size = 0;
    }
    chunks.at(-1)!.push(turn);
    size += length;
  }
  return chunks;
}

/** Smallest context window (in tokens, multiple of 1024) that fits `chars` of prompt. */
export function contextSizeFor(chars: number): number {
  const needed = Math.ceil(chars / CHARS_PER_TOKEN) + RESERVED_TOKENS;
  return Math.min(Math.ceil(needed / 1024) * 1024, MAX_CONTEXT_TOKENS);
}

export function renderNotes(notes: Notes, transcript: Transcript): string {
  const labels = labelsFor(transcript.language);
  const section = (title: string, lines: string[]) =>
    lines.length > 0 ? [`## ${title}`, lines.join("\n")] : [];
  const actionItems = notes.actionItems.map((item) => {
    const owner = item.owner ? `**${item.owner}:** ` : "";
    const due = item.due ? ` (${labels.due}: ${item.due})` : "";
    return `- [ ] ${owner}${item.task}${due}`;
  });

  return [
    `# ${notes.title || labels.summary}`,
    ...(notes.summary ? [`## ${labels.summary}`, notes.summary] : []),
    ...section(labels.keyPoints, notes.keyPoints.map((point) => `- ${point}`)),
    ...section(labels.decisions, notes.decisions.map((decision) => `- ${decision}`)),
    ...section(labels.actionItems, actionItems),
    ...section(labels.openQuestions, notes.openQuestions.map((question) => `- ${question}`)),
    `## ${labels.transcript}`,
    renderTurns(transcript),
  ].join("\n\n") + "\n";
}

function systemPrompt(language: string): string {
  const labels = labelsFor(language);
  const outputLanguage =
    labelsFor(language) === labelsFor("en") && language !== "en"
      ? "the language of the transcript"
      : labels.languageName;
  return `You write the notes of a meeting from its transcript.

The transcript has two speaker labels. "${labels.me}" is the person who recorded
the meeting and will read these notes. "${labels.others}" is everyone else: one or
several people who cannot be told apart, so consecutive lines may come from
different people; they may be named in the conversation.
The transcript is automatic and may contain misheard words.

Rules:
- Use only what the transcript says. Never invent facts, names, owners or dates.
- Write everything in ${outputLanguage}.
- title: a short title describing the meeting.
- summary: one short paragraph.
- keyPoints: the main points discussed.
- decisions: only what was actually agreed.
- actionItems: tasks someone committed to, one item per task; never join tasks of
  different people. "owner" is the person's name if it is said (someone asked by
  name who accepts is the owner), "${labels.me}" when the person who recorded is
  responsible, "${labels.others}" when an unnamed participant is responsible, or ""
  if nobody took it. "due" is the date or deadline as it was said, or "".
- openQuestions: questions raised and left unanswered.
- Use an empty list when a section has nothing.`;
}

/** The conversation as plain "Speaker: text" lines; timestamps would only cost tokens. */
function promptText(turns: Turn[], language: string): string {
  const labels = labelsFor(language);
  return turns.map((turn) => `${labels[turn.speaker]}: ${turn.text}`).join("\n");
}

function normalize(notes: Partial<Notes>): Notes {
  const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  return {
    title: notes.title?.trim() ?? "",
    summary: notes.summary?.trim() ?? "",
    keyPoints: list(notes.keyPoints),
    decisions: list(notes.decisions),
    actionItems: list(notes.actionItems).map((item) => ({
      owner: item.owner?.trim() ?? "",
      task: item.task?.trim() ?? "",
      due: item.due?.trim() ?? "",
    })),
    openQuestions: list(notes.openQuestions),
  };
}
