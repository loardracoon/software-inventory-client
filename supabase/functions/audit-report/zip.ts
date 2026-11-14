// The ZIP of an evidence package. Lives beside the function because _shared stays free of npm: imports.

import { zipSync } from "npm:fflate@0.8.3";
import type { EvidenceFile, Manifest } from "../_shared/evidence.ts";

// The mtime of every entry is the generation time (from the manifest), so the same input gives the same bytes.
export function zipEvidence(files: EvidenceFile[], manifestBytes: Uint8Array): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = f.name === "manifest.json" ? manifestBytes : f.bytes;
  const generatedAt = (JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest).generated_at;
  return zipSync(entries, { mtime: new Date(generatedAt) });
}
