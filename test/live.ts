import { NamelixClient } from "../src/namelix.ts";

const client = new NamelixClient();
const start = Date.now();
const result = await client.generate({
  keywords: "artisan coffee roaster",
  style: "brandable",
  count: 5,
  tlds: ["com", "io"],
});
const ms = Date.now() - start;

console.log(`Got ${result.names.length} names in ${ms}ms`);
if (result.note) console.log(`Note: ${result.note}`);
for (const n of result.names) {
  console.log(
    `  - ${n.name.padEnd(24)} ${n.tagline.slice(0, 40).padEnd(42)} [${n.domainsAvailable.join(",") || "—"}]`,
  );
}
