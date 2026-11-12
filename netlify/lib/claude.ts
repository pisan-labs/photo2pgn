// The one Claude call: read scoresheet photos into structured moves.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ExtractionSchema, type Extraction } from "../../src/lib/schema";
import type { Effort } from "./config";

export const SYSTEM_PROMPT = `You transcribe photographs of chess scoresheets: the forms players fill in by hand during over-the-board tournament games. Your transcription is checked move by move for legality by a chess engine and then reviewed by a person, so faithful reading matters more than a tidy result.

Layout. A sheet usually has a header (event, site, date, round, board, player names, ratings) and a move table where each row has a move number, White's move and Black's move. Many sheets have two blocks side by side, such as moves 1-30 on the left and 31-60 on the right; read the left block top to bottom, then the right block. Several images are pages of the same game in order, and later pages continue the move numbers.

For every move cell:
- written: the move exactly as written, in the sheet's own language and symbols (German Sf3, French Cf3, Russian Кf3, 0-0, ×, :).
- san: the same move in English Standard Algebraic Notation: K Q R B N, no letter for pawns, x for captures, O-O and O-O-O, =Q for promotions, and + or # only if the player wrote a check or mate sign. Convert descriptive notation (P-K4) too.
- alternatives: other readings the strokes allow, as English SAN, most likely first.
- legibility: clear, unclear, or illegible.

Follow the position as you read. When the handwriting allows more than one reading, prefer the one that is legal and fits the game, and list the others as alternatives. Do not replace a clearly written move with a different one because it looks illegal or bad: players do write wrong moves, and the engine and the reviewer need to see what is on the sheet.

A crossed-out move with a correction next to it: use the correction and say so in notes. An empty cell is null. Stop at the last written move. Leave header fields empty when the sheet does not show them; write dates as YYYY.MM.DD with ?? for unknown parts; take the result from the result box or a marked result, or * if none. If the image is not a chess scoresheet, set isScoresheet to false and return no rows.`;

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64
}

export interface ReadResult {
  extraction: Extraction;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

export class ReadError extends Error {
  constructor(
    public code: "bad_key" | "rate_limited" | "refused" | "too_long" | "unreadable" | "upstream",
    message: string,
  ) {
    super(message);
  }
}

export async function readScoresheet(opts: {
  apiKey: string;
  model: string;
  effort: Effort;
  images: ImageInput[];
  baseURL: string;
}): Promise<ReadResult> {
  // baseURL is always passed: the SDK would otherwise read ANTHROPIC_BASE_URL.
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...opts.images.map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      }),
    ),
    {
      type: "text",
      text:
        opts.images.length > 1
          ? `Transcribe this game. The ${opts.images.length} images are its pages in order.`
          : "Transcribe this game.",
    },
  ];

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: opts.model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, format: betaZodOutputFormat(ExtractionSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ReadError("bad_key", "The Anthropic API key was rejected.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ReadError("rate_limited", "Anthropic is rate limiting this key. Try again in a minute.");
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ReadError("upstream", `Anthropic rejected the request: ${err.message}`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ReadError("upstream", `Anthropic API error ${err.status ?? ""}: ${err.message}`);
    }
    throw err;
  }

  if (message.stop_reason === "refusal") {
    throw new ReadError("refused", "Claude declined to read this image.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ReadError("too_long", "The transcription ran past the length limit.");
  }
  const extraction = message.parsed_output;
  if (!extraction) {
    throw new ReadError("unreadable", "Claude's answer could not be parsed.");
  }
  return {
    extraction,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: message.model,
    },
  };
}
