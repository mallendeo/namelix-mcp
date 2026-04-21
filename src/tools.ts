import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type GenerateInput,
  type GenerateOutput,
  NamelixClient,
} from "./namelix.ts";

const STYLE_ENUM = [
  "auto",
  "brandable",
  "evocative",
  "short_phrase",
  "compound",
  "alternate_spelling",
  "non_english",
  "real_words",
] as const;

const RANDOMNESS_ENUM = ["low", "medium", "high"] as const;

const commonShape = {
  keywords: z.string().min(1).describe("Seed terms, comma or space separated."),
  description: z
    .string()
    .optional()
    .describe("Longer brand description. Steers the generator."),
  style: z
    .enum(STYLE_ENUM)
    .optional()
    .describe(
      "brandable=Google/Rolex, evocative=RedBull, short_phrase=Dollar Shave Club, compound=FedEx, alternate_spelling=Lyft, non_english=Toyota, real_words=Apple. auto picks automatically.",
    ),
  max_length: z
    .union([z.literal(10), z.literal(15), z.literal(20)])
    .optional()
    .describe("Max characters per name. Default 15."),
  randomness: z
    .enum(RANDOMNESS_ENUM)
    .optional()
    .describe("Default medium. high produces less predictable names."),
  count: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Number of names. Default 10, max 25."),
  require_domain: z
    .boolean()
    .optional()
    .describe(
      "Only return names with at least one available TLD from `tlds`. Shrinks results.",
    ),
  tlds: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "TLDs to check. Default ['com']. Each result's `domainsAvailable` lists the free ones.",
    ),
  avoid: z.array(z.string().min(1)).optional().describe("Names to exclude."),
};

const refineShape = {
  ...commonShape,
  previous: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Full list of names already shown to the user. Namelix uses this to avoid repeats and diverge; a partial list produces less variety.",
    ),
  feedback: z
    .string()
    .optional()
    .describe("User feedback on the previous batch. Appended to `description`."),
};

const GENERATE_DESCRIPTION =
  "Generate brand-name candidates via namelix.com. Returns { names: [{ name, tagline, domainsAvailable }], note? }.";

const REFINE_DESCRIPTION =
  "Generate a next batch excluding names already shown. Pass every name from prior calls in `previous` (not just rejected). Put user feedback in `feedback`.";

export function registerTools(
  server: McpServer,
  client: NamelixClient,
): void {
  server.registerTool(
    "generate_names",
    { description: GENERATE_DESCRIPTION, inputSchema: commonShape },
    async (args) => {
      const result = await client.generate(toGenerateInput(args));
      return formatResult(result);
    },
  );

  server.registerTool(
    "refine_names",
    { description: REFINE_DESCRIPTION, inputSchema: refineShape },
    async (args) => {
      const input = toGenerateInput(args);
      const avoid = mergeLists(input.avoid ?? [], args.previous);
      const description = args.feedback
        ? [input.description, args.feedback].filter(Boolean).join(". ")
        : input.description;
      const refined: GenerateInput = {
        ...input,
        avoid,
        ...(description ? { description } : {}),
      };
      const result = await client.generate(refined);
      return formatResult(result);
    },
  );
}

function toGenerateInput(args: {
  keywords: string;
  description?: string | undefined;
  style?: (typeof STYLE_ENUM)[number] | undefined;
  max_length?: 10 | 15 | 20 | undefined;
  randomness?: (typeof RANDOMNESS_ENUM)[number] | undefined;
  count?: number | undefined;
  require_domain?: boolean | undefined;
  tlds?: string[] | undefined;
  avoid?: string[] | undefined;
}): GenerateInput {
  const input: GenerateInput = { keywords: args.keywords };
  if (args.description !== undefined) input.description = args.description;
  if (args.style !== undefined) input.style = args.style;
  if (args.max_length !== undefined) input.maxLength = args.max_length;
  if (args.randomness !== undefined) input.randomness = args.randomness;
  if (args.count !== undefined) input.count = args.count;
  if (args.require_domain !== undefined)
    input.requireDomain = args.require_domain;
  if (args.tlds !== undefined) input.tlds = args.tlds;
  if (args.avoid !== undefined) input.avoid = args.avoid;
  return input;
}

function mergeLists(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function formatResult(result: GenerateOutput) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result, null, 2) },
    ],
  };
}
