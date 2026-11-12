// The transcription instructions, used by the browser reader and handed to the
// local CLI reader, so both read sheets the same way.
import { z } from "zod";
import { ExtractionSchema } from "./schema";

export const SYSTEM_PROMPT = `You transcribe photographs of chess scoresheets: the forms players fill in by hand during over-the-board tournament games. Your transcription is checked move by move for legality by a chess engine and then reviewed by a person, so faithful reading matters more than a tidy result.

Layout. A sheet usually has a header (event, site, date, round, board, player names, ratings) and a move table where each row has a move number, White's move and Black's move. Many sheets have two blocks side by side, such as moves 1-30 on the left and 31-60 on the right; read the left block top to bottom, then the right block. Several images are pages of the same game in order, and later pages continue the move numbers.

For every move cell:
- written: the move exactly as written, in the sheet's own language and symbols (German Sf3, French Cf3, Russian Кf3, 0-0, ×, :).
- san: the same move in English Standard Algebraic Notation: K Q R B N, no letter for pawns, x for captures, O-O and O-O-O, =Q for promotions, and + or # only if the player wrote a check or mate sign. Convert descriptive notation (P-K4) too.
- alternatives: other readings the strokes allow, as English SAN, most likely first.
- legibility: clear, unclear, or illegible.

Follow the position as you read. When the handwriting allows more than one reading, prefer the one that is legal and fits the game, and list the others as alternatives. Do not replace a clearly written move with a different one because it looks illegal or bad: players do write wrong moves, and the engine and the reviewer need to see what is on the sheet.

Handwriting can be very poor. When you can make out only part of a move, write what you can see in written with _ for each unreadable character (N_3, B_5, _xd4) and give your best guesses as san and alternatives; the engine tries every legal move that fits. Do not skip a cell because it is hard to read: an honest partial reading helps more than nothing.

A crossed-out move with a correction next to it: use the correction and say so in notes. An empty cell is null. Stop at the last written move. Leave header fields empty when the sheet does not show them; write dates as YYYY.MM.DD with ?? for unknown parts; take the result from the result box or a marked result, or * if none. If the image is not a chess scoresheet, set isScoresheet to false and return no rows.`;

export function userText(pages: number): string {
  return pages > 1 ? `Transcribe this game. The ${pages} images are its pages in order.` : "Transcribe this game.";
}

/** JSON Schema for the answer, for readers that take a plain schema (claude --json-schema). */
export function extractionJsonSchema(): Record<string, unknown> {
  const schema = { ...(z.toJSONSchema(ExtractionSchema) as Record<string, unknown>) };
  delete schema.$schema;
  return schema;
}
