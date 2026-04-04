/**
 * Medical Synonym Expansion for Call Transcript Search
 *
 * When searching transcripts, expands medical abbreviations and terms to
 * include their synonyms. For example, searching "O2" also matches "oxygen",
 * and searching "wheelchair" also matches "wc", "w/c", "power wheelchair".
 *
 * This dramatically improves search recall in a medical supply context where
 * agents frequently use abbreviations in calls.
 *
 * Synonym dictionary ported from ums-knowledge-reference/backend/src/services/vectorStore.ts.
 */

const MEDICAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  // Equipment
  ["wheelchair", ["wc", "w/c", "power wheelchair", "manual wheelchair"]],
  ["cpap", ["continuous positive airway pressure", "c-pap"]],
  ["bipap", ["bilevel", "bi-pap", "bilevel positive airway pressure", "bpap"]],
  ["oxygen", ["o2", "supplemental oxygen"]],
  ["concentrator", ["oxygen concentrator", "poc", "portable oxygen concentrator"]],
  ["nebulizer", ["neb", "aerosol therapy"]],
  ["catheter", ["cath", "foley", "intermittent catheter", "straight cath"]],
  ["hospital bed", ["semi-electric bed", "full-electric bed"]],
  ["walker", ["rollator", "rolling walker"]],
  ["scooter", ["pov", "power operated vehicle", "mobility scooter"]],
  ["pmd", ["power mobility device", "power wheelchair", "power chair"]],
  ["ventilator", ["vent", "mechanical ventilation"]],
  ["commode", ["bedside commode", "bsc", "3-in-1 commode"]],
  ["lift", ["patient lift", "hoyer lift", "hoyer"]],
  ["tens", ["tens unit", "transcutaneous electrical nerve stimulation"]],
  ["mattress", ["pressure mattress", "alternating pressure", "overlay"]],
  ["mask", ["nasal mask", "full face mask", "nasal pillow"]],

  // Clinical abbreviations
  ["copd", ["chronic obstructive pulmonary disease"]],
  ["chf", ["congestive heart failure", "heart failure"]],
  ["osa", ["obstructive sleep apnea", "sleep apnea"]],
  ["als", ["amyotrophic lateral sclerosis"]],
  ["ms", ["multiple sclerosis"]],
  ["cva", ["cerebrovascular accident", "stroke"]],
  ["dvt", ["deep vein thrombosis"]],
  ["uti", ["urinary tract infection"]],
  ["bmi", ["body mass index"]],
  ["rom", ["range of motion"]],
  ["ahi", ["apnea hypopnea index"]],

  // DME process terms
  ["dme", ["durable medical equipment"]],
  ["hcpcs", ["healthcare common procedure coding system"]],
  ["cmn", ["certificate of medical necessity"]],
  ["lcd", ["local coverage determination"]],
  ["abn", ["advance beneficiary notice"]],
  ["f2f", ["face to face", "face-to-face"]],
  ["spo2", ["oxygen saturation", "pulse oximetry", "pulse ox"]],
  ["prior auth", ["prior authorization", "pa"]],
  ["prior authorization", ["prior auth", "pa"]],

  // Insurance/billing
  ["deductible", ["ded"]],
  ["coinsurance", ["coins"]],
  ["denial", ["denied", "claim denial", "rejected"]],
  ["appeal", ["redetermination", "reconsideration"]],
  ["eob", ["explanation of benefits"]],
  ["mbi", ["medicare beneficiary identifier"]],
]);

// Build reverse lookup: for any term, find all its synonyms
const synonymIndex = new Map<string, string[]>();
for (const [key, synonyms] of MEDICAL_SYNONYMS) {
  const group = [key, ...synonyms];
  for (const term of group) {
    const lower = term.toLowerCase();
    if (!synonymIndex.has(lower)) synonymIndex.set(lower, []);
    for (const other of group) {
      const otherLower = other.toLowerCase();
      if (otherLower !== lower && !synonymIndex.get(lower)!.includes(otherLower)) {
        synonymIndex.get(lower)!.push(otherLower);
      }
    }
  }
}

/**
 * Expand a search query with medical synonyms.
 * Returns the original query plus any synonym-expanded terms.
 *
 * Example: "patient needs O2" → "patient needs O2 oxygen supplemental oxygen"
 */
export function expandMedicalSynonyms(query: string): string {
  const lower = query.toLowerCase();
  const expansions: string[] = [];

  for (const [term, synonyms] of synonymIndex) {
    // Word-boundary match to avoid partial matches (e.g., "ms" in "terms")
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (regex.test(lower)) {
      for (const syn of synonyms) {
        if (!lower.includes(syn.toLowerCase())) {
          expansions.push(syn);
        }
      }
    }
  }

  return expansions.length > 0 ? `${query} ${expansions.join(" ")}` : query;
}

/**
 * Get synonyms for a specific term (if any).
 */
export function getSynonyms(term: string): string[] {
  return synonymIndex.get(term.toLowerCase()) || [];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
