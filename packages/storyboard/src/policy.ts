import type { ChartSpec, Claim, ComponentNameType, FormatId } from "@hc/schemas";
import type { SceneIntentType, SceneLayoutType, VisualStrategyType } from "@hc/schemas";

/**
 * Visual policy: what each beat looks like.
 *
 * Two rules govern everything here.
 *
 * First, a visual must be buildable from the reviewed claim. If a beat has no
 * approved figure, the studio does not draw a number, and if it has no visual
 * hint the studio does not guess at an anatomical illustration. Inventing a
 * chart is the visual equivalent of inventing a citation.
 *
 * Second, one idea per scene. A scene that shows a brain, a bar chart, a counter
 * and a paragraph of type is four scenes wearing a trench coat, and the viewer
 * reads none of them.
 */

/** One drawn element in a scene, and how loudly it should read. */
export interface PolicyComponent {
  component: ComponentNameType;
  params: Record<string, unknown>;
  emphasis: "normal" | "highlight" | "dim" | "focus";
}

export interface ScenePlan {
  intent: SceneIntentType;
  visual_strategy: VisualStrategyType;
  layout: SceneLayoutType;
  palette: string;
  components: PolicyComponent[];
  chart?: ChartSpec;
  on_screen_text: string | null;
  subtext: string | null;
  /** Reason the visual is what it is, surfaced for human review. */
  rationale: string;
}

/** Map a script beat's free-text intent onto the closed scene-intent union. */
export function sceneIntentFor(intent: string): SceneIntentType {
  const map: Record<string, SceneIntentType> = {
    hook: "hook",
    question: "hook",
    setup: "setup",
    context: "setup",
    define: "setup",
    mechanism: "mechanism",
    explain: "mechanism",
    process: "process",
    sequence: "process",
    steps: "process",
    evidence: "evidence",
    study: "evidence",
    data: "data_beat",
    number: "data_beat",
    quantify: "data_beat",
    counter: "data_beat",
    compare: "comparison",
    comparison: "comparison",
    versus: "comparison",
    contrast: "comparison",
    myth: "myth_reveal",
    reveal: "myth_reveal",
    myth_bust: "myth_reveal",
    timeline: "timeline_beat",
    sequence_time: "timeline_beat",
    payoff: "payoff",
    takeaway: "payoff",
    summary: "payoff",
    caveat: "caveat",
    qualify: "caveat",
    limit: "caveat",
    cta: "cta",
  };
  return map[intent.trim().toLowerCase()] ?? "mechanism";
}

/** Palettes are named, not hexed, so the renderer owns colour and the brand can change once. */
const PALETTE_BY_CATEGORY: Record<string, string> = {
  nutrition: "warm",
  sleep: "indigo",
  fitness: "ember",
  myth: "slate",
  supplement: "ember",
  mechanism: "teal",
  data: "slate",
  comparison: "teal",
  timeline: "indigo",
  "system-journey": "teal",
};

export function paletteFor(format: FormatId): string {
  return PALETTE_BY_CATEGORY[format] ?? "neutral";
}

function layoutFor(strategy: VisualStrategyType, intent: SceneIntentType): SceneLayoutType {
  if (intent === "hook") return "type_dominant";
  if (intent === "cta") return "card";
  if (intent === "caveat") return "lower_third";
  switch (strategy) {
    case "title_card":
      return "type_dominant";
    case "chart_led":
    case "data_mosaic":
      return "mosaic";
    case "comparison_split":
      return "split";
    case "timeline_track":
      return "left_stack";
    case "system_map":
      return "full_bleed";
    case "diagram_led":
      return "center";
    default:
      return "center";
  }
}

/** The measure itself: "mg per 240 ml cup" measures mg, over a cup. */
function dimensionOf(unit: string): string {
  return unit.split(/\s+per\s+/)[0]!.trim().toLowerCase();
}

/** The basis a figure is stated over: "240 ml cup" from "mg per 240 ml cup". */
function basisOf(figure: { label?: string; per?: string; unit: string; display: string; value: number }): string {
  if (figure.label) return figure.label;
  if (figure.per) return figure.per;
  const [, basis] = figure.unit.split(/\s+per\s+/);
  if (basis) return basis.trim();
  return figure.display || String(figure.value);
}

/**
 * Build a chart from a claim's approved figures, or return undefined.
 *
 * The claim's visual hint decides the chart kind; the figures decide the data.
 * If the figures do not fit the hinted kind, the hint is ignored rather than
 * bent, because a bar chart of two unrelated quantities is a lie told in pixels.
 */
export function chartFor(claim: Claim | undefined): { chart: ChartSpec; rationale: string } | undefined {
  if (!claim) return undefined;
  const figures = claim.figures;
  if (figures.length === 0) return undefined;
  const hint = claim.visual_strategy_hint;

  // Two or more approved figures that share a unit form a scale, and a scale is
  // a comparison however the reviewer tagged it: the narration that says "95 mg
  // while a 60 ml espresso has 63 mg" is weaker drawn as a single counter.
  //
  // The unit is read as a dimension plus an optional basis ("mg per 240 ml
  // cup"). Comparing the whole string found no scale in the one place the
  // corpus most obviously has one, because two servings of the same measure
  // always spell the measure differently.
  const comparable =
    figures.length >= 2 &&
    dimensionOf(figures[0]!.unit) !== "" &&
    dimensionOf(figures[0]!.unit) === dimensionOf(figures[1]!.unit);

  if (hint === "counter" && figures.length >= 1 && !comparable) {
    const f = figures[0];
    if (!f) return undefined;
    // A suffix is a unit like "mg" or "hours", not a whole phrase like
    // "mg per 240 ml cup"; the full basis belongs in the sublabel.
    const suffix = f.unit && !f.display.includes(f.unit) ? f.unit.split(/\s+/)[0]!.slice(0, 12) : "";
    return {
      chart: {
        kind: "counter",
        value: f.value,
        display: f.display || String(f.value),
        label: f.label || f.unit,
        sublabel: f.per,
        prefix: "",
        suffix,
      },
      rationale: `single approved figure "${f.display || f.value}" presented as a counter`,
    };
  }

  if ((hint === "chart" || hint === "comparison" || comparable) && figures.length >= 2) {
    const [a, b] = figures;
    if (!a || !b) return undefined;
    // A comparison is only honest when the two figures share a measure. "95 mg
    // per cup" and "5 hours half-life" are not two sides of the same scale.
    const dimension = dimensionOf(a.unit);
    const sameDimension = dimension !== "" && dimension === dimensionOf(b.unit);
    // A reviewer's "counter" hint does not veto a scale the data already
    // provides; an explicit "chart" hint still gets the bar form.
    if (sameDimension && (hint === "comparison" || (hint === "counter" && comparable))) {
      return {
        chart: {
          kind: "comparison",
          left: { label: basisOf(a), value: a.value, ...(a.display ? { display: a.display } : {}) },
          right: { label: basisOf(b), value: b.value, ...(b.display ? { display: b.display } : {}) },
          unit: dimension,
          verdict: "",
        },
        rationale: `two approved figures sharing the measure "${dimension}", shown as a direct comparison`,
      };
    }
    return {
      chart: {
        kind: "bar",
        title: "",
        unit: sameDimension ? dimension : "",
        data: figures.slice(0, 6).map((f) => ({
          label: basisOf(f),
          value: f.value,
          ...(f.display ? { display: f.display } : {}),
          highlight: f === a,
        })),
      },
      rationale: sameDimension
        ? `${figures.length} approved figures sharing a measure, shown as bars`
        : `${figures.length} approved figures with differing measures, shown as labelled bars rather than a shared scale`,
    };
  }

  if (hint === "chart" && figures.length >= 1) {
    return {
      chart: {
        kind: "stat_tile",
        tiles: figures.slice(0, 4).map((f) => ({
          value: `${f.display || String(f.value)}${f.unit ? ` ${f.unit}` : ""}`,
          label: f.label || f.per || basisOf(f),
          note: f.about ? "approximate" : "",
        })),
      },
      rationale: "approved figures shown as discrete stat tiles, with no implied scale",
    };
  }

  return undefined;
}

/** Components the renderer implements, filtered against the closed union. */
const KNOWN_COMPONENTS = new Set<string>([
  "Brain",
  "Heart",
  "Lungs",
  "Stomach",
  "Liver",
  "Kidney",
  "Intestine",
  "Muscle",
  "Pancreas",
  "Skin",
  "BloodVessel",
  "Cell",
  "Neuron",
  "BodySilhouette",
  "Molecule",
  "Receptor",
  "Hormone",
  "Membrane",
  "Enzyme",
  "ATP",
  "Signal",
  "Pathway",
  "Nutrient",
  "TimelineTrack",
  "Counter",
  "BigNumber",
  "ComparisonBars",
  "PaperCard",
  "GlassPanel",
  "Callout",
  "StatTile",
  "KeyValueList",
]);

/**
 * On-screen type is shortened from the claim, never reworded. Cutting a claim
 * down to a caption is safe in a way that rewriting it is not, and the length
 * limit is a readability limit as much as a schema one.
 *
 * A reviewer caveat is always surfaced. A caveat that lives only in a review
 * tool is a caveat the viewer never sees, which is exactly how a qualified
 * finding turns into an unqualified claim out in the world.
 */
export function onScreenTextFor(claim: Claim | undefined, intent: SceneIntentType): { text: string | null; subtext: string | null } {
  if (!claim) return { text: null, subtext: null };
  if (intent === "caveat") {
    return { text: claim.caveat ? "Worth knowing" : null, subtext: claim.caveat || null };
  }
  const first = claim.text.split(/(?<=[.!?])\s+/)[0] ?? claim.text;
  const trimmed = first.length <= 96 ? first : `${first.slice(0, 93).replace(/[\s,;:]+\S*$/, "")}...`;
  const subtext = claim.caveat || (claim.claim_type === "association" ? "association, not cause" : "");
  return { text: trimmed, subtext: subtext || null };
}

/**
 * Turns a chart spec into component params.
 *
 * The chart carries the claim's approved figures and the component carries the
 * drawing; without this mapping the component renders empty and the figures
 * never reach the screen. Every chart kind maps onto the params the renderer's
 * components actually read.
 */
export function paramsForComponent(chart: ChartSpec): Record<string, unknown> {
  switch (chart.kind) {
    case "counter": {
      const label = `${chart.prefix}${chart.display}${chart.suffix ? ` ${chart.suffix}` : ""}`.trim();
      return { label, value: chart.value };
    }
    case "comparison":
      return {
        series: [
          { label: chart.left.label, value: chart.left.value, unit: chart.unit },
          { label: chart.right.label, value: chart.right.value, unit: chart.unit },
        ],
      };
    case "bar":
      return {
        series: chart.data.map((d) => ({ label: d.label, value: d.value, unit: chart.unit })),
      };
    case "line":
      return {
        points: (chart.series[0]?.values ?? []).map((v, i) => ({
          x: i,
          y: v,
          label: chart.xLabels[i] ?? "",
        })),
      };
    case "percentage":
      return { value: chart.value / 100, label: `${chart.value}%` };
    case "stat_tile":
      return {
        // Both shapes are passed: the renderer reads `tiles` when present, and a
        // consumer that only knows about `series` still gets the figures.
        tiles: chart.tiles.map((t) => ({ value: t.value, label: t.label, note: t.note })),
        series: chart.tiles.map((t) => ({ label: t.label, value: Number(t.value) || 0 })),
      };
  }
}

/** The component that canonically carries each chart kind. */
const CHART_CARRIER: Record<ChartSpec["kind"], ComponentNameType> = {
  counter: "Counter",
  comparison: "ComparisonBars",
  bar: "BarChart",
  line: "LineChart",
  percentage: "PercentageRing",
  stat_tile: "StatTile",
};

/**
 * Components able to carry each chart kind, best first.
 *
 * A reviewer's hint is honoured only when the component it names can actually
 * read the chart's params. Handing a comparison's series to a counter produced
 * a frame with a zero in it, which is worse than ignoring the hint.
 */
const CHART_CANDIDATES: Record<ChartSpec["kind"], ComponentNameType[]> = {
  counter: ["Counter", "BigNumber"],
  comparison: ["ComparisonBars", "BarChart", "RankingBars"],
  bar: ["BarChart", "RankingBars", "ComparisonBars"],
  line: ["LineChart", "BarChart"],
  percentage: ["PercentageRing", "Counter", "BigNumber"],
  stat_tile: ["StatTile", "KeyValueList", "Counter"],
};

/** Components whose drawing is made of figures, and so need approved figures. */
const DATA_COMPONENTS = new Set<string>([
  "Counter",
  "BigNumber",
  "ComparisonBars",
  "BarChart",
  "RankingBars",
  "LineChart",
  "PercentageRing",
  "StatTile",
  "KeyValueList",
  "TimelineTrack",
]);

export function planScene(claim: Claim | undefined, intent: SceneIntentType, format: FormatId): ScenePlan {
  const chartResult = chartFor(claim);
  // A component that draws numbers is only planned when there are approved
  // numbers to draw. A counter with no figure behind it renders a zero, and a
  // timeline with no approved events renders a bare line: both read as data
  // that went missing rather than as an illustration.
  const hints = (claim?.visual_hints ?? []).filter(
    (h) => KNOWN_COMPONENTS.has(h) && (chartResult !== undefined || !DATA_COMPONENTS.has(h)),
  );
  const hint = claim?.visual_strategy_hint;

  let strategy: VisualStrategyType;
  let rationale: string;
  if (chartResult && (hint === "counter" || hint === "chart" || hint === "comparison")) {
    // The chart decides the shot: two sides of one scale are a split, a single
    // figure is a number to land on, anything else is led by the data.
    const kind = chartResult.chart.kind;
    strategy = kind === "comparison" ? "comparison_split" : kind === "counter" ? "data_mosaic" : "chart_led";
    rationale = chartResult.rationale;
  } else if (hint === "comparison") {
    strategy = "comparison_split";
    rationale = "reviewer asked for a comparison, but the approved figures do not share a scale, so no comparison is drawn";
  } else if (hint === "photographic") {
    strategy = "photo_led";
    rationale = "reviewer requested photography; assets are resolved by the rights-checked asset stage";
  } else if (intent === "hook") {
    strategy = "title_card";
    rationale = "the hook carries type, not illustration, so the first second lands on the question";
  } else if (intent === "cta") {
    strategy = "title_card";
    rationale = "the call to action is a single readable card";
  } else if (hints.length > 0) {
    strategy = hint === "flow" ? "system_map" : "diagram_led";
    rationale = `reviewer-approved components (${hints.join(", ")}) carry the claim`;
  } else {
    strategy = "component_only";
    rationale = "no approved figure or component, so the scene stays typographic rather than inventing an illustration";
  }

  // Annotated because a bare ternary widens `emphasis` to `string`, which the
  // component contract does not allow.
  //
  // When a chart exists it is the scene's primary focal point and exactly one
  // component carries it: two components presenting the same approved figure
  // would read as repetition, and an uncarried chart is a figure that never
  // reaches the screen.
  const components: PolicyComponent[] = chartResult
    ? [
        {
          component:
            (hints.find((h) =>
              CHART_CANDIDATES[chartResult.chart.kind].includes(h as ComponentNameType),
            ) as ComponentNameType | undefined) ?? CHART_CARRIER[chartResult.chart.kind],
          params: paramsForComponent(chartResult.chart),
          emphasis: "focus",
        },
      ]
    : hints.map((component) => ({
        component: component as ComponentNameType,
        params: {},
        emphasis: hints.length === 1 ? "focus" : "normal",
      }));

  const { text, subtext } = onScreenTextFor(claim, intent);
  const layout = layoutFor(strategy, intent);
  return {
    intent,
    visual_strategy: strategy,
    layout,
    palette: paletteFor(format),
    components,
    ...(chartResult ? { chart: chartResult.chart } : {}),
    on_screen_text: text,
    subtext,
    rationale,
  };
}


