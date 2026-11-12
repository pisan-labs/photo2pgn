// What Claude returns after reading a scoresheet photo. Shared by the
// Netlify worker (as the structured-output schema) and the browser (types).
import { z } from "zod";

export const PlyReadingSchema = z.object({
  written: z
    .string()
    .describe(
      "The move exactly as handwritten in the cell, in the sheet's own notation and language. Empty string if the cell is blank.",
    ),
  san: z
    .string()
    .describe(
      "Your best reading of the move converted to English Standard Algebraic Notation (K Q R B N, O-O / O-O-O, x for captures, =Q for promotion). Empty string if illegible.",
    ),
  alternatives: z
    .array(z.string())
    .describe(
      "Other readings the handwriting supports, as English SAN, most likely first. At most 3. Empty if the move is clear.",
    ),
  legibility: z
    .enum(["clear", "unclear", "illegible"])
    .describe("How confident the reading is."),
});

export const MoveRowSchema = z.object({
  number: z.number().describe("Move number printed on the sheet."),
  white: PlyReadingSchema.nullable().describe("White's move, or null if the cell is empty."),
  black: PlyReadingSchema.nullable().describe("Black's move, or null if the cell is empty."),
});

export const GameHeadersSchema = z.object({
  event: z.string().describe("Tournament or event name; empty if not written."),
  site: z.string().describe("City, venue or site; empty if not written."),
  date: z
    .string()
    .describe("Game date as YYYY.MM.DD, using ?? for unknown parts (e.g. 2026.??.??); empty if not written."),
  round: z.string().describe("Round number (e.g. 3 or 3.1); empty if not written."),
  board: z.string().describe("Board or table number; empty if not written."),
  white: z.string().describe("White player's name as written, Surname, Firstname if possible; empty if not written."),
  black: z.string().describe("Black player's name as written, Surname, Firstname if possible; empty if not written."),
  whiteElo: z.string().describe("White's rating, digits only; empty if not written."),
  blackElo: z.string().describe("Black's rating, digits only; empty if not written."),
  result: z
    .enum(["1-0", "0-1", "1/2-1/2", "*"])
    .describe("Result as marked on the sheet; * if not marked."),
});

export const ExtractionSchema = z.object({
  isScoresheet: z
    .boolean()
    .describe("False if the image is not a chess scoresheet or no moves can be read."),
  notationLanguage: z
    .string()
    .describe(
      "Two-letter language code of the piece letters used on the sheet (en, de, fr, es, it, nl, pt, ru, pl, cs, hu, tr, sv, ...).",
    ),
  headers: GameHeadersSchema,
  rows: z.array(MoveRowSchema).describe("Every move row that has at least one move, in game order."),
  notes: z
    .string()
    .describe("Anything the reviewer should know: crossed-out moves, a second page, damaged areas. Empty if nothing."),
});

export type PlyReading = z.infer<typeof PlyReadingSchema>;
export type MoveRow = z.infer<typeof MoveRowSchema>;
export type GameHeaders = z.infer<typeof GameHeadersSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
