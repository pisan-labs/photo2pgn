// The one Claude call: read scoresheet photos into structured moves.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ExtractionSchema, type Extraction } from "../../src/lib/schema";
import type { Effort } from "./config";
import { SYSTEM_PROMPT, userText } from "./prompt";



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
    { type: "text", text: userText(opts.images.length) },
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
