// Reads scoresheet photos with Claude from the browser, through the
// template's ask(): the visitor's own key (straight to api.anthropic.com) or
// the HintWise gateway (the owner's key, for signed-in users, within caps).
//
// The gateway passes only model, max_tokens, system, messages and tools, so
// the answer comes back as one call of the record_scoresheet tool, checked
// against the same schema the CLI reader's answer is checked against.
import { ask, isRefusal, type AskDeps, type Message, type Tool } from "./llm";
import { ExtractionSchema, type Extraction } from "./schema";
import { SYSTEM_PROMPT, extractionJsonSchema, userText } from "./prompt";

export const READ_TOOL_NAME = "record_scoresheet";

/** Through the gateway: photo2pgn's limit there (owner, 12 Nov). */
export const GATEWAY_MAX_TOKENS = 8000;
/** With the visitor's own key, straight to Anthropic. */
export const BYOK_MAX_TOKENS = 16000;

export const TOOL_INSTRUCTION = `Record your transcription by calling the ${READ_TOOL_NAME} tool exactly once, with the whole game. Do not answer in text.`;

export function readTool(): Tool {
  return {
    name: READ_TOOL_NAME,
    description: "Record the transcription of the scoresheet: header, every move cell, and notes.",
    input_schema: extractionJsonSchema() as Tool["input_schema"],
  };
}

export interface PhotoInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64
}

export class ReadFailed extends Error {
  constructor(
    public readonly code: "refused" | "too_long" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "ReadFailed";
  }
}

export interface ReadResult {
  extraction: Extraction;
  usage: Message["usage"];
  model: string;
}

export function readRequest(photos: PhotoInput[], maxTokens = GATEWAY_MAX_TOKENS) {
  return {
    system: `${SYSTEM_PROMPT}\n\n${TOOL_INSTRUCTION}`,
    max_tokens: maxTokens,
    tools: [readTool()],
    messages: [
      {
        role: "user" as const,
        content: [
          ...photos.map((p) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: p.mediaType, data: p.data },
          })),
          { type: "text" as const, text: userText(photos.length) },
        ],
      },
    ],
  };
}

/** Turn Claude's answer into a checked Extraction, or explain why not. */
export function extractionFrom(message: Message): Extraction {
  if (isRefusal(message)) throw new ReadFailed("refused", "Claude declined to read this photo.");
  const call = message.content.find((b) => b.type === "tool_use" && b.name === READ_TOOL_NAME);
  if (message.stop_reason === "max_tokens") {
    throw new ReadFailed("too_long", "The game is too long to read in one go. Try one page at a time.");
  }
  if (!call || call.type !== "tool_use") {
    throw new ReadFailed("unreadable", "Claude did not return a transcription. Try again, or try a clearer photo.");
  }
  const parsed = ExtractionSchema.safeParse(call.input);
  if (!parsed.success) {
    throw new ReadFailed("unreadable", "Claude's transcription was incomplete. Try again.");
  }
  return parsed.data;
}

/** One reading, in the mode and with the dependencies given (tests pass fakes). */
export async function readScoresheet(photos: PhotoInput[], deps: AskDeps = {}): Promise<ReadResult> {
  const message = await ask(readRequest(photos, deps.mode === "byok" ? BYOK_MAX_TOKENS : GATEWAY_MAX_TOKENS), deps);
  return { extraction: extractionFrom(message), usage: message.usage, model: message.model };
}
