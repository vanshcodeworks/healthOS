/**
 * Procedural anatomy.
 *
 * These are line drawings, not icons: an organ is described by its contour and a
 * handful of interior marks that carry anatomy, the same way a figure in a
 * textbook is drawn. No fills, no gradients, no shadows — a filled silhouette is
 * what turns anatomy into clip art, and the interior marks are what make it read
 * as a diagram.
 *
 * Every figure is authored in its own viewBox so it can be placed and scaled
 * without knowing anything about the rest of the frame. The renderer applies the
 * hand-drawn treatment, the draw-on animation and the highlight state; the
 * geometry here is only shape.
 *
 * Coordinate convention: y grows downward, as it does in SVG. Paths are written
 * the way they would be drawn, with the dominant contour first, so a `draw` on
 * stroke 0 outlines the organ before anything inside it appears.
 */

export type StrokeRole =
  /** The contour that defines the organ. Drawn first, heaviest. */
  | "contour"
  /** Interior anatomy: rugae, septa, calyces, gyri. */
  | "detail"
  /** A tube: vessel, oesophagus, intestine, ureter. */
  | "tube"
  /** A lumen or cavity that gets filled. */
  | "cavity";

export interface AnatomyStroke {
  d: string;
  role: StrokeRole;
  /** Nominal width multiplier, relative to the figure's base stroke. */
  weight?: number;
  /** Closed shapes can be filled with the accent tint. */
  closed?: boolean;
  /** Draw order hint within the figure. */
  order?: number;
}

export interface AnatomyLabel {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  /** Which contour the leader line points at, by stroke index. */
  target?: number;
  role: "part" | "context";
}

export interface AnatomyFigure {
  viewBox: { w: number; h: number };
  strokes: AnatomyStroke[];
  labels: AnatomyLabel[];
  /** Optional inset marks: hatching, ticks, a scale bar. */
  marks?: { d: string; weight?: number }[];
}

const S = (d: string, role: StrokeRole, extra: Partial<AnatomyStroke> = {}): AnatomyStroke => ({
  d,
  role,
  ...extra,
});

/** Stomach. Cardia, fundus, body, antrum, pylorus, duodenum. */
const stomach: AnatomyFigure = {
  viewBox: { w: 360, h: 430 },
  strokes: [
    S(
      "M 168 6 C 166 40 168 62 176 84 " +
        "C 132 92 100 118 94 162 " +
        "C 88 202 98 242 118 272 " +
        "C 140 304 172 330 212 334 " +
        "C 244 337 268 326 286 306 " +
        "L 300 296",
      "tube",
      { order: 0 },
    ),
    S(
      "M 300 296 C 322 306 330 328 324 352 " +
        "C 318 376 300 392 278 396 " +
        "C 266 380 252 368 234 366",
      "tube",
      { order: 1 },
    ),
    S(
      "M 176 84 C 214 96 244 116 258 142 " +
        "C 274 172 274 208 262 240 " +
        "C 250 272 228 296 204 308 " +
        "C 190 280 182 250 178 218 " +
        "C 174 184 172 140 176 84 Z",
      "contour",
      { closed: true, order: 2 },
    ),
    S("M 196 104 C 216 116 228 134 232 154", "detail", { order: 6 }),
    S("M 186 132 C 210 142 226 158 232 178", "detail", { order: 7 }),
    S("M 184 166 C 208 174 224 188 232 206", "detail", { order: 8 }),
    S("M 188 200 C 210 206 226 218 234 234", "detail", { order: 9 }),
    S("M 196 234 C 214 238 230 248 240 260", "detail", { order: 10 }),
    S("M 210 268 C 226 270 240 278 250 288", "detail", { order: 11 }),
    S("M 178 84 C 172 62 170 40 168 6", "tube", { order: 12, weight: 0.7 }),
    S("M 120 288 C 128 306 138 318 152 328", "detail", { order: 13 }),
  ],
  labels: [
    { x: 268, y: 96, text: "fundus", anchor: "start", target: 2, role: "part" },
    { x: 292, y: 300, text: "pylorus", anchor: "start", target: 1, role: "part" },
    { x: 150, y: 360, text: "duodenum", anchor: "middle", target: 1, role: "part" },
    { x: 120, y: 200, text: "body", anchor: "end", target: 2, role: "part" },
  ],
};

/** Small intestine as a continuous coil. */
const smallIntestine: AnatomyFigure = {
  viewBox: { w: 380, h: 420 },
  strokes: [
    S(
      "M 60 24 C 130 10 250 12 316 34 " +
        "C 350 46 356 78 330 92 " +
        "C 296 110 168 96 74 116 " +
        "C 22 126 12 164 46 180 " +
        "C 92 202 250 178 322 200 " +
        "C 358 212 360 250 328 262 " +
        "C 282 278 132 258 66 282 " +
        "C 28 296 28 336 66 348 " +
        "C 118 366 244 344 306 362 " +
        "C 340 371 344 400 316 408",
      "tube",
      { order: 0 },
    ),
    S("M 74 116 C 150 132 250 128 322 112", "detail", { order: 5 }),
    S("M 46 180 C 128 158 246 158 330 178", "detail", { order: 6 }),
    S("M 32 240 C 120 218 250 220 344 240", "detail", { order: 7 }),
  ],
  labels: [
    { x: 330, y: 44, text: "duodenum", anchor: "end", role: "part" },
    { x: 190, y: 250, text: "jejunum", anchor: "middle", role: "part" },
    { x: 190, y: 300, text: "ileum", anchor: "middle", role: "part" },
  ],
};

/** Large intestine: the frame around the small bowel, with haustra. */
const largeIntestine: AnatomyFigure = {
  viewBox: { w: 400, h: 430 },
  strokes: [
    S("M 92 24 C 76 60 70 104 74 146 C 78 186 84 214 86 250", "tube", { order: 0 }),
    S("M 308 24 C 324 62 330 108 326 150 C 322 190 316 216 314 252", "tube", { order: 1 }),
    S("M 86 250 C 140 240 250 240 314 252", "tube", { order: 2 }),
    S("M 314 252 C 336 288 342 330 330 372 C 322 400 300 414 268 412", "tube", { order: 3 }),
    S("M 86 250 C 62 288 56 330 68 372 C 76 400 98 414 130 412", "tube", { order: 4 }),
    S("M 130 412 C 176 420 224 420 268 412", "tube", { order: 5 }),
    S("M 108 30 C 100 30 96 38 98 48 C 106 50 114 46 116 38", "detail", { order: 6 }),
    S("M 108 78 C 100 78 96 86 98 96 C 106 98 114 94 116 86", "detail", { order: 7 }),
    S("M 104 126 C 96 126 92 134 94 144 C 102 146 110 142 112 134", "detail", { order: 8 }),
    S("M 292 30 C 300 30 304 38 302 48 C 294 50 286 46 284 38", "detail", { order: 9 }),
    S("M 292 78 C 300 78 304 86 302 96 C 294 98 286 94 284 86", "detail", { order: 10 }),
    S("M 296 126 C 304 126 308 134 306 144 C 298 146 290 142 288 134", "detail", { order: 11 }),
    S("M 160 258 C 200 252 250 252 288 258", "detail", { order: 12 }),
    S("M 160 288 C 200 282 250 282 288 288", "detail", { order: 13 }),
  ],
  labels: [
    { x: 60, y: 20, text: "ascending", anchor: "start", target: 4, role: "part" },
    { x: 340, y: 20, text: "descending", anchor: "end", target: 3, role: "part" },
    { x: 200, y: 100, text: "transverse", anchor: "middle", target: 2, role: "part" },
    { x: 200, y: 434, text: "sigmoid", anchor: "middle", target: 3, role: "part" },
  ],
};

/** Kidney in section, with calyces and the hilum. */
const kidney: AnatomyFigure = {
  viewBox: { w: 320, h: 400 },
  strokes: [
    S(
      "M 196 26 C 118 22 62 82 58 176 " +
        "C 54 268 106 350 178 366 " +
        "C 214 373 236 356 232 328 " +
        "C 228 306 206 296 200 274 " +
        "C 194 252 208 236 222 224 " +
        "C 244 206 250 176 244 140 " +
        "C 236 84 220 30 196 26 Z",
      "contour",
      { closed: true, order: 0 },
    ),
    S("M 186 74 C 142 82 116 116 112 164 C 108 214 130 268 168 300", "detail", { order: 1 }),
    S("M 214 108 C 196 122 190 140 194 158", "detail", { order: 2 }),
    S("M 218 176 C 200 186 194 200 198 216", "detail", { order: 3 }),
    S("M 214 244 C 198 252 194 264 198 278", "detail", { order: 4 }),
    S("M 232 328 C 258 336 268 358 262 380", "tube", { order: 5 }),
    S("M 244 140 C 268 148 282 166 284 188", "tube", { order: 6 }),
  ],
  labels: [
    { x: 96, y: 74, text: "cortex", anchor: "start", target: 0, role: "part" },
    { x: 140, y: 200, text: "medulla", anchor: "start", target: 1, role: "part" },
    { x: 268, y: 130, text: "renal artery", anchor: "start", role: "part" },
    { x: 276, y: 356, text: "ureter", anchor: "start", role: "part" },
  ],
};

/** A vessel in section: lumen, wall, and a branch. */
const bloodVessel: AnatomyFigure = {
  viewBox: { w: 420, h: 300 },
  strokes: [
    S("M 12 108 C 110 96 200 128 300 112 C 350 104 386 112 408 128", "contour", { order: 0 }),
    S("M 12 190 C 110 202 200 172 300 188 C 350 196 386 188 408 172", "contour", { order: 1 }),
    S("M 150 130 C 176 140 190 164 186 190 C 182 214 160 226 138 216", "tube", { order: 2 }),
    S("M 186 190 C 214 176 246 168 272 172", "tube", { order: 3 }),
    S("M 272 172 C 292 154 300 130 296 106", "tube", { order: 4 }),
    S("M 272 172 C 296 190 320 200 344 198", "tube", { order: 5 }),
    S("M 40 132 C 90 124 140 138 190 140", "detail", { order: 6 }),
    S("M 220 158 C 268 150 320 156 360 168", "detail", { order: 7 }),
  ],
  labels: [
    { x: 300, y: 66, text: "lumen", anchor: "middle", target: 0, role: "part" },
    { x: 96, y: 226, text: "wall", anchor: "middle", target: 1, role: "part" },
    { x: 300, y: 244, text: "branch", anchor: "middle", target: 3, role: "part" },
  ],
};

/** Heart, anterior view, with the great vessels. */
const heart: AnatomyFigure = {
  viewBox: { w: 360, h: 400 },
  strokes: [
    S(
      "M 150 30 C 120 44 106 76 108 112 " +
        "C 84 128 70 160 74 200 " +
        "C 78 250 100 300 132 338 " +
        "C 152 360 170 370 182 366 " +
        "C 200 360 214 336 224 306 " +
        "C 240 258 244 200 232 156 " +
        "C 224 124 206 100 182 92 " +
        "C 176 70 168 44 150 30 Z",
      "contour",
      { closed: true, order: 0 },
    ),
    S("M 182 92 C 190 66 208 46 232 36 C 250 30 264 38 262 52 C 258 74 240 88 222 96", "tube", { order: 1 }),
    S("M 150 30 C 138 14 116 10 102 20 C 90 30 94 46 110 52", "tube", { order: 2 }),
    S("M 126 52 C 104 46 84 52 76 68", "tube", { order: 3 }),
    S("M 150 108 C 168 122 180 146 182 176", "detail", { order: 4 }),
    S("M 110 168 C 140 158 176 158 208 170", "detail", { order: 5 }),
    S("M 100 214 C 134 200 186 200 226 216", "detail", { order: 6 }),
    S("M 96 262 C 130 246 188 246 234 264", "detail", { order: 7 }),
  ],
  labels: [
    { x: 268, y: 44, text: "aorta", anchor: "start", target: 1, role: "part" },
    { x: 78, y: 96, text: "pulmonary", anchor: "end", target: 3, role: "part" },
    { x: 96, y: 150, text: "atrium", anchor: "end", role: "part" },
    { x: 210, y: 300, text: "ventricle", anchor: "start", role: "part" },
  ],
};

/** Brain, lateral view. */
const brain: AnatomyFigure = {
  viewBox: { w: 400, h: 360 },
  strokes: [
    S(
      "M 84 232 C 46 216 34 176 48 142 " +
        "C 46 104 74 70 112 60 " +
        "C 136 26 186 18 222 38 " +
        "C 258 22 302 38 316 72 " +
        "C 352 88 366 128 348 162 " +
        "C 356 200 330 234 292 240 " +
        "C 268 268 214 274 178 254 " +
        "C 148 264 106 256 84 232 Z",
      "contour",
      { closed: true, order: 0 },
    ),
    S("M 132 62 C 128 96 140 122 164 136 C 186 150 196 176 188 204", "detail", { order: 1 }),
    S("M 226 44 C 220 78 232 106 256 120", "detail", { order: 2 }),
    S("M 300 84 C 288 112 296 140 320 156", "detail", { order: 3 }),
    S("M 96 122 C 130 108 168 108 200 122", "detail", { order: 4 }),
    S("M 86 176 C 122 158 168 158 208 174", "detail", { order: 5 }),
    S("M 100 216 C 136 198 186 198 224 214", "detail", { order: 6 }),
    S("M 178 254 C 176 220 186 190 208 168 C 226 150 246 140 268 138", "detail", { order: 7 }),
  ],
  labels: [
    { x: 96, y: 44, text: "cortex", anchor: "start", target: 0, role: "part" },
    { x: 300, y: 208, text: "cerebellum", anchor: "start", target: 0, role: "part" },
    { x: 96, y: 288, text: "brainstem", anchor: "start", target: 7, role: "part" },
  ],
};

/** Lungs with the bronchial tree. */
const lungs: AnatomyFigure = {
  viewBox: { w: 400, h: 400 },
  strokes: [
    S(
      "M 196 74 C 152 68 108 96 92 148 " +
        "C 78 196 84 262 108 306 " +
        "C 124 336 152 348 172 334 " +
        "C 188 322 192 292 190 258 " +
        "C 188 208 194 128 196 74 Z",
      "contour",
      { closed: true, order: 0 },
    ),
    S(
      "M 204 74 C 248 68 292 96 308 148 " +
        "C 322 196 316 262 292 306 " +
        "C 276 336 248 348 228 334 " +
        "C 212 322 208 292 210 258 " +
        "C 212 208 206 128 204 74 Z",
      "contour",
      { closed: true, order: 1 },
    ),
    S("M 200 44 C 200 62 200 78 196 92", "tube", { order: 2 }),
    S("M 160 96 C 176 118 184 142 182 168", "tube", { order: 3 }),
    S("M 146 148 C 140 180 140 214 148 244", "tube", { order: 4 }),
    S("M 240 96 C 224 118 216 142 218 168", "tube", { order: 5 }),
    S("M 254 148 C 260 180 260 214 252 244", "tube", { order: 6 }),
    S("M 120 190 C 140 178 164 178 182 190", "detail", { order: 7 }),
    S("M 220 190 C 238 178 262 178 282 190", "detail", { order: 8 }),
  ],
  labels: [
    { x: 96, y: 336, text: "left lung", anchor: "end", target: 0, role: "part" },
    { x: 300, y: 336, text: "right lung", anchor: "start", target: 1, role: "part" },
    { x: 200, y: 26, text: "trachea", anchor: "middle", target: 2, role: "part" },
  ],
};

/** A cell: membrane, nucleus, mitochondria, rough ER. */
const cell: AnatomyFigure = {
  viewBox: { w: 400, h: 400 },
  strokes: [
    S(
      "M 200 26 C 286 26 356 84 366 168 " +
        "C 376 254 316 340 226 358 " +
        "C 134 376 48 320 34 232 " +
        "C 20 144 96 34 200 26 Z",
      "contour",
      { closed: true, order: 0 },
    ),
    S("M 200 140 C 246 140 280 172 280 212 C 280 254 244 284 200 284 C 154 284 120 254 120 212 C 120 172 154 140 200 140 Z", "cavity", { closed: true, order: 1 }),
    S("M 168 186 C 186 176 214 178 232 190", "detail", { order: 2 }),
    S("M 166 232 C 188 240 214 236 234 222", "detail", { order: 3 }),
    S("M 292 108 C 320 118 336 142 332 168 C 328 192 302 202 282 190 C 262 178 260 148 274 128", "detail", { order: 4 }),
    S("M 96 246 C 122 234 150 238 168 258", "detail", { order: 5 }),
    S("M 76 168 C 96 156 118 158 134 170", "detail", { order: 6 }),
  ],
  labels: [
    { x: 200, y: 122, text: "nucleus", anchor: "middle", target: 1, role: "part" },
    { x: 356, y: 108, text: "membrane", anchor: "end", target: 0, role: "part" },
    { x: 360, y: 168, text: "mitochondrion", anchor: "end", target: 4, role: "part" },
  ],
};

/** A receptor on a membrane, with its ligand. */
const receptor: AnatomyFigure = {
  viewBox: { w: 360, h: 400 },
  strokes: [
    S("M 20 288 C 90 274 150 302 220 288 C 268 278 312 292 344 282", "contour", { order: 0 }),
    S("M 20 300 C 90 286 150 314 220 300 C 268 290 312 304 344 294", "contour", { order: 1, weight: 0.7 }),
    S("M 132 288 C 140 250 140 220 132 186 C 140 168 168 168 176 186 C 168 220 168 250 176 288", "tube", { order: 2 }),
    S("M 132 186 C 140 156 168 156 176 186", "detail", { order: 3 }),
    S("M 154 132 C 140 116 142 92 158 80 C 176 66 200 74 202 96 C 204 116 186 132 168 138", "contour", { closed: true, order: 4 }),
    S("M 200 316 C 214 340 216 362 206 380", "tube", { order: 5 }),
  ],
  labels: [
    { x: 196, y: 60, text: "ligand", anchor: "middle", target: 4, role: "part" },
    { x: 106, y: 240, text: "receptor", anchor: "end", target: 2, role: "part" },
    { x: 250, y: 340, text: "signal", anchor: "start", target: 5, role: "part" },
  ],
};

/** A capillary bed: one arteriole branching into a network. */
const capillaryBed: AnatomyFigure = {
  viewBox: { w: 400, h: 320 },
  strokes: [
    S("M 12 96 C 70 96 108 108 140 130", "tube", { order: 0 }),
    S("M 140 130 C 176 152 220 158 262 146 C 300 136 330 140 356 156", "tube", { order: 1 }),
    S("M 140 130 C 168 106 196 96 226 100 C 250 104 262 122 254 138", "tube", { order: 2 }),
    S("M 254 138 C 246 156 226 164 206 158 C 186 152 176 136 180 118", "tube", { order: 3 }),
    S("M 180 118 C 184 100 202 88 222 92", "tube", { order: 4 }),
    S("M 262 146 C 268 172 254 196 228 202 C 200 208 178 194 174 170", "tube", { order: 5 }),
    S("M 12 96 C 40 122 52 152 50 186 C 48 224 30 258 6 282", "tube", { order: 6 }),
    S("M 174 170 C 170 200 152 222 126 232", "tube", { order: 7 }),
  ],
  labels: [
    { x: 8, y: 78, text: "arteriole", anchor: "start", target: 0, role: "part" },
    { x: 366, y: 150, text: "venule", anchor: "end", target: 1, role: "part" },
    { x: 216, y: 76, text: "capillary", anchor: "middle", target: 2, role: "part" },
  ],
};

/** A molecule: a skeleton with heteroatoms, drawn as a structural formula. */
const molecule: AnatomyFigure = {
  viewBox: { w: 400, h: 320 },
  strokes: [
    S("M 60 200 L 130 132 L 210 176 L 290 116 L 344 160", "contour", { order: 0 }),
    S("M 130 132 L 118 58", "contour", { order: 1 }),
    S("M 210 176 L 232 252", "contour", { order: 2 }),
    S("M 290 116 L 320 60", "contour", { order: 3 }),
    S("M 60 200 C 76 236 108 252 142 240", "tube", { order: 4 }),
  ],
  labels: [
    { x: 108, y: 44, text: "O", anchor: "middle", target: 1, role: "part" },
    { x: 328, y: 46, text: "N", anchor: "middle", target: 3, role: "part" },
    { x: 240, y: 276, text: "CH₃", anchor: "middle", target: 2, role: "part" },
    { x: 60, y: 200, text: "C₈", anchor: "end", target: 0, role: "part" },
  ],
};

export const ANATOMY: Record<string, AnatomyFigure> = {
  stomach,
  small_intestine: smallIntestine,
  large_intestine: largeIntestine,
  intestine: largeIntestine,
  kidney,
  blood_vessel: bloodVessel,
  heart,
  brain,
  lungs,
  cell,
  receptor,
  capillary_bed: capillaryBed,
  molecule,
};

export const ANATOMY_KEYS = Object.keys(ANATOMY);

/** A figure's aspect ratio, for laying it out without distorting it. */
export function anatomyAspect(name: string): number {
  const figure = ANATOMY[name];
  if (!figure) return 1;
  return figure.viewBox.w / figure.viewBox.h;
}
