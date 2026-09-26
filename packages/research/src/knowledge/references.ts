import type { EvidenceLevelType, FormatId, CategoryId, LicenseKindType, HookTypeType } from "@hc/schemas";

/**
 * A citation in the curated knowledge base.
 *
 * `verification` starts as "pending". The SourceVerifier stage resolves every
 * citation (URL reachability, DOI resolution) whenever the network is
 * available and downgrades the evidence level of any claim it cannot confirm.
 * Nothing enters a published video on the strength of memory alone.
 */
export interface KbSource {
  key: string;
  title: string;
  publisher: string;
  url: string;
  type: "journal" | "guideline" | "government" | "textbook" | "reference_site" | "preprint";
  level: EvidenceLevelType;
  design?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  /**
   * True when the publisher is known to reject automated clients with a 403
   * while serving the page fine in a browser. Such a source is real but cannot be
   * machine-verified, so any claim resting on it alone must be blocked by the QA
   * gate rather than published on an unverified citation.
   */
  bot_blocked?: boolean;
  /** Short form used on the in-video source card and in the description. */
  short: string;
}

export interface KbClaim {
  id: string;
  /** Speakable sentence; the writer may rephrase but not strengthen it. */
  text: string;
  level: EvidenceLevelType;
  sources: string[];
  permitted: string[];
  forbidden: string[];
  /** Safe quantitative statements, e.g. "about 95 mg in a 240 ml cup". */
  numbers: { value: string; unit: string; about: boolean }[];
  caveat?: string;
  components: string[];
  /** Preferred visual strategy for the scene that speaks this claim. */
  visual?: "diagram" | "chart" | "counter" | "comparison" | "flow" | "photographic";
}

export interface KbTopic {
  id: string;
  slug: string;
  title: string;
  question: string;
  category: CategoryId;
  format: FormatId;
  keywords: string[];
  /** 0..1: how well this can be explained with designed motion graphics. */
  visual_score: number;
  educational_score: number;
  shareability: number;
  /**
   * Hook variants; the experimentation system rotates between them.
   *
   * Typed as the closed hook union rather than `string`, so a mistyped hook type
   * is a compile error in the knowledge base instead of a schema failure three
   * stages later, after a script and a storyboard have been built around it.
   */
  hooks: { type: HookTypeType; text: string }[];
  claims: KbClaim[];
  /**
   * Scene arc in beats. A 30-60s short runs roughly 5-8 beats at 5-8 seconds
   * each, so the range is 2..10; the storyboard stage may merge or split beats
   * but must not silently invent them.
   */
  arc: string[];
  cta: string;
  source_card: string[];
  license_note?: string;
}

const SOURCES: KbSource[] = [
  {
    key: "ods_caffeine",
    title: "Caffeine: Fact Sheet for Health Professionals",
    publisher: "NIH Office of Dietary Supplements",
    url: "https://ods.od.nih.gov/factsheets/Caffeine/",
    type: "government",
    level: "government_health_authority",
    short: "NIH ODS — Caffeine fact sheet",
    /**
     * The ODS fact sheet returns 403 to automated clients, so a claim resting on
     * it alone cannot be machine-verified and the QA gate blocks it. Claims that
     * need a second, machine-checkable authority pair it with efsa_caffeine.
     */
    bot_blocked: true,
  },
  {
    key: "efsa_caffeine",
    title: "Scientific Opinion on the safety of caffeine",
    publisher: "European Food Safety Authority (EFSA) Panel on Food Additives and Nutrient Sources",
    url: "https://doi.org/10.2903/j.efsa.2015.4102",
    type: "guideline",
    level: "government_health_authority",
    year: 2015,
    design: "guideline",
    doi: "10.2903/j.efsa.2015.4102",
    short: "EFSA — Scientific opinion on the safety of caffeine (2015)",
  },
  {
    key: "ods_protein",
    title: "Protein: Fact Sheet for Health Professionals",
    publisher: "NIH Office of Dietary Supplements",
    url: "https://ods.od.nih.gov/factsheets/Protein/",
    type: "government",
    level: "government_health_authority",
    short: "NIH ODS — Protein fact sheet",
  },
  {
    key: "cdc_sleep_amount",
    title: "About Sleep",
    publisher: "US Centers for Disease Control and Prevention",
    // Re-anchored after the CDC sleep microsite restructure retired
    // /sleep/about_sleep/how_much_sleep.html (verified 404 during source audit).
    url: "https://www.cdc.gov/sleep/about/index.html",
    type: "government",
    level: "government_health_authority",
    short: "CDC — recommended sleep by age",
  },
  {
    key: "who_physical_activity",
    title: "Physical activity",
    publisher: "World Health Organization",
    url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
    type: "government",
    level: "government_health_authority",
    short: "WHO — Physical activity fact sheet",
  },
  {
    key: "who_healthy_diet",
    title: "Healthy diet",
    publisher: "World Health Organization",
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    type: "government",
    level: "government_health_authority",
    short: "WHO — Healthy diet fact sheet",
  },
  {
    key: "efsa_water",
    title: "Scientific Opinion on Dietary Reference Values for water",
    publisher: "European Food Safety Authority (EFSA) Panel on Dietetic Products, Nutrition and Allergies",
    url: "https://www.efsa.europa.eu/en/efsajournal/pub/1409",
    type: "guideline",
    level: "guideline",
    year: 2010,
    design: "guideline",
    doi: "10.2903/j.efsa.2010.1409",
    short: "EFSA — Dietary reference values for water (2010)",
  },
  {
    key: "efsa_fibre",
    title: "Scientific Opinion on Dietary Reference Values for fibre",
    publisher: "European Food Safety Authority (EFSA) Panel on Dietetic Products, Nutrition and Allergies",
    url: "https://www.efsa.europa.eu/en/efsajournal/pub/1462",
    type: "guideline",
    level: "guideline",
    year: 2010,
    design: "guideline",
    doi: "10.2903/j.efsa.2010.1462",
    short: "EFSA — Dietary reference values for fibre (2010)",
  },
  {
    key: "efsa_sugars",
    title: "Scientific Opinion on Dietary Reference Values for sugars",
    publisher: "European Food Safety Authority (EFSA) Panel on Dietetic Products, Nutrition and Allergies",
    url: "https://www.efsa.europa.eu/en/efsajournal/pub/1468",
    type: "guideline",
    level: "guideline",
    year: 2010,
    design: "guideline",
    doi: "10.2903/j.efsa.2010.1468",
    short: "EFSA — Dietary reference values for sugars (2010)",
  },
  {
    key: "issn_protein_position",
    title: "International Society of Sports Nutrition Position Stand: protein and exercise",
    publisher: "Journal of the International Society of Sports Nutrition",
    url: "https://doi.org/10.1186/s12970-017-0177-8",
    type: "journal",
    level: "guideline",
    year: 2017,
    design: "guideline",
    doi: "10.1186/s12970-017-0177-8",
    short: "ISSN position stand — protein and exercise (2017)",
  },
  {
    key: "issn_creatine_safety",
    title: "International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine",
    publisher: "Journal of the International Society of Sports Nutrition",
    // The DOI suffix is "-0173-z". The original "-0173-y" did not resolve and was
    // caught by the source audit; Kreider et al. 2017, JISSN 14:18, PMID 28615996.
    url: "https://doi.org/10.1186/s12970-017-0173-z",
    type: "journal",
    level: "guideline",
    year: 2017,
    design: "guideline",
    doi: "10.1186/s12970-017-0173-z",
    pmid: "28615996",
    short: "ISSN position stand — creatine safety and efficacy (2017)",
  },
  {
    key: "niddk_digestive",
    title: "Digestive Diseases",
    publisher: "National Institute of Diabetes and Digestive and Kidney Diseases",
    url: "https://www.niddk.nih.gov/health-information/digestive-diseases",
    type: "government",
    level: "government_health_authority",
    short: "NIDDK — Digestive diseases",
  },
  {
    key: "nhs_digestion_indigestion",
    title: "Indigestion",
    publisher: "NHS (United Kingdom)",
    url: "https://www.nhs.uk/conditions/indigestion/",
    type: "government",
    level: "government_health_authority",
    short: "NHS — Indigestion",
  },
  {
    key: "medlineplus_metabolism",
    title: "Energy Metabolism",
    publisher: "MedlinePlus (US National Library of Medicine)",
    url: "https://medlineplus.gov/ency/article/002442.htm",
    type: "reference_site",
    level: "government_health_authority",
    short: "MedlinePlus — Energy metabolism",
  },
  {
    key: "acsM_exercise_fluid",
    title: "Exercise and Fluid Replacement",
    publisher: "Medicine & Science in Sports & Exercise (ACSM position stand)",
    url: "https://doi.org/10.1249/mss.0b013e31802ca597",
    type: "journal",
    level: "guideline",
    year: 2007,
    design: "guideline",
    doi: "10.1249/mss.0b013e31802ca597",
    short: "ACSM position stand — Exercise and fluid replacement (2007)",
  },
  {
    key: "guyton_hall",
    title: "Guyton and Hall Textbook of Medical Physiology, 14th edition",
    publisher: "Elsevier (standard physiology reference)",
    // elsevier.com retired the old /books/<slug>/<isbn> route (verified 404 during
    // the source audit). The Evolve product page is the stable publisher record.
    url: "https://evolve.elsevier.com/cs/product/9780323640053",
    type: "textbook",
    level: "narrative_review",
    year: 2021,
    short: "Guyton & Hall — Textbook of Medical Physiology, 14e",
  },
  {
    key: "boron_medical_physiology",
    title: "Boron & Boulpaep Medical Physiology, 4th edition",
    publisher: "Elsevier (Boron & Boulpaep)",
    url: "https://evolve.elsevier.com/cs/product/9780323794862",
    type: "textbook",
    level: "narrative_review",
    short: "Boron & Boulpaep — Medical Physiology, 4e",
  },
  {
    key: "cdc_healthy_weight_nutrition",
    title: "Healthy Eating and Nutrition",
    publisher: "US Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/healthy-weight-growth/healthy-eating/",
    type: "government",
    level: "government_health_authority",
    short: "CDC — Healthy eating and nutrition",
  },
];

export const KB_SOURCES = new Map(SOURCES.map((source) => [source.key, source]));

export function kbSource(key: string): KbSource {
  const source = KB_SOURCES.get(key);
  if (!source) throw new Error(`Knowledge base references unknown source "${key}"`);
  return source;
}

export const KB_LICENSE: LicenseKindType = "own_original";

