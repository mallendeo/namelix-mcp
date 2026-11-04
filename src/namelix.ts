export type Style =
  | "auto"
  | "brandable"
  | "evocative"
  | "short_phrase"
  | "compound"
  | "alternate_spelling"
  | "non_english"
  | "real_words";

export type Randomness = "low" | "medium" | "high";

export type MaxLength = 10 | 15 | 20;

export interface GenerateInput {
  keywords: string;
  description?: string;
  style?: Style;
  maxLength?: MaxLength;
  randomness?: Randomness;
  count?: number;
  requireDomain?: boolean;
  tlds?: string[];
  avoid?: string[];
}

export interface NameResult {
  name: string;
  tagline: string;
  domainsAvailable: string[];
}

export interface GenerateOutput {
  names: NameResult[];
  note?: string;
}

interface RawNamelixItem {
  businessName?: string;
  description?: string;
  domains?: string;
  [key: string]: unknown;
}

interface NamelixGenerateResponse {
  logos?: RawNamelixItem[];
  new_bans?: unknown[];
  premium?: unknown[];
  premium_atom?: unknown[];
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const NAMELIX_URL = "https://namelix.com/generate";
const NAMES_PER_CALL = 5;
const DEFAULT_MAX_RETRIES = 20;
const DEFAULT_RETRY_DELAY_MS = 2000;

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface NamelixClientOptions {
  fetchFn?: FetchLike;
  maxRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
}

export class NamelixClient {
  private readonly fetchFn: FetchLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly userAgent: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: NamelixClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const count = clamp(input.count ?? 10, 1, 25);
    const style = input.style ?? "auto";
    const maxLength = input.maxLength ?? 15;
    const randomness = input.randomness ?? "medium";
    const tlds = input.tlds?.length ? input.tlds : ["com"];
    const seed = Math.floor(Math.random() * 1_000_000_000);

    const seen = new Map<string, NameResult>();
    const avoidList = dedupeCaseInsensitive(input.avoid ?? []);

    const callsNeeded = Math.ceil(count / NAMES_PER_CALL);
    let allEmpty = true;

    for (let page = 0; page < callsNeeded && seen.size < count; page++) {
      const prevNames = [
        ...avoidList,
        ...Array.from(seen.values()).map((n) => n.name),
      ];

      const response = await this.postWithRetry({
        keywords: input.keywords,
        description: input.description ?? "",
        style: style,
        maxLength,
        randomness: randomness,
        requireDomain: input.requireDomain ?? false,
        extensions: tlds,
        prevNames,
        page,
        seed,
      });

      const items = response.logos ?? [];

      if (items.length > 0) allEmpty = false;

      for (const item of items) {
        const name = (item.businessName ?? "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          name,
          tagline: (item.description ?? "").trim(),
          domainsAvailable: parseDomains(item.domains),
        });
        if (seen.size >= count) break;
      }

      if (items.length === 0) break;
    }

    const names = Array.from(seen.values()).slice(0, count);

    if (names.length === 0) {
      return {
        names,
        note: allEmpty
          ? "no names returned; try broader keywords or disable require_domain"
          : "no new names after dedup",
      };
    }

    return { names };
  }

  private async postWithRetry(params: {
    keywords: string;
    description: string;
    style: string;
    maxLength: number;
    randomness: string;
    requireDomain: boolean;
    extensions: string[];
    prevNames: string[];
    page: number;
    seed: number;
  }): Promise<NamelixGenerateResponse> {
    const body = JSON.stringify({
      request_id: crypto.randomUUID(),
      keywords: params.keywords,
      description: params.description,
      blacklist: "",
      max_length: String(params.maxLength),
      style: params.style,
      random: params.randomness,
      extensions: params.extensions,
      require_domains: params.requireDomain ? true : false,
      prev_names: params.prevNames.join("|"),
      saved: "",
      premium_index: 0,
      page: params.page,
      num: NAMES_PER_CALL,
      seed: params.seed,
      category: "",
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.fetchFn(NAMELIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": this.userAgent,
          Accept: "application/json",
          Referer: "https://namelix.com/app/",
          Origin: "https://namelix.com",
        },
        body,
      });

      if (!res.ok) {
        throw new Error(
          `namelix returned HTTP ${res.status} ${res.statusText}`,
        );
      }

      const text = await res.text();
      const trimmed = text.trim();
      if (trimmed === "error") {
        throw new Error("namelix returned 'error' body");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(
          `namelix returned unparseable body (first 200 chars): ${trimmed.slice(0, 200)}`,
        );
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("namelix response was not an object");
      }

      const response = parsed as NamelixGenerateResponse;
      const logos = response.logos ?? [];
      if (logos.length > 0) return response;

      if (attempt === this.maxRetries) return response;
      await this.sleep(this.retryDelayMs);
    }

    return {};
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function parseDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
