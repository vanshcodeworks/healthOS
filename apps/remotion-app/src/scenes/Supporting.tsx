/**
 * Comparison, timeline, conclusion, disclaimer.
 *
 * Four grammars that all lean on typography and rules rather than drawing, which
 * is the correct answer when the content is a relationship, an order, or a
 * statement. A comparison drawn as two illustrations would be decoration; the
 * comparison is the numbers and the verdict.
 */

import { SceneShell, SafeBox, primaryFigure, type SceneProps } from "./shared.js";
import { DataViz } from "../components/DataViz.js";
import { Anatomy } from "../components/Anatomy.js";
import { Deck, Eyebrow, Headline } from "../components/EditorialText.js";
import { MeasuredRule } from "../art/texture.js";
import { Bracket } from "../components/Marks.js";
import { CONTENT, SPACE } from "../art/spacing.js";
import { FONTS, TYPE } from "../art/typography.js";
import { ease } from "../motion/ease.js";
import { handPath } from "../art/hand.js";
import { drawPath } from "../motion/draw.js";

export function Comparison(props: SceneProps) {
  const { scene, palette, frame, fps } = props;
  const chart = scene.chart;
  const headline = scene.headline || "";
  const hasChart = chart && (chart.kind === "comparison" || chart.kind === "bar");
  return (
    <SceneShell {...props}>
      <SafeBox justify="center">
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.lg }}>
          {headline ? (
            <Eyebrow text={headline} palette={palette} frame={frame} fps={fps} delayFrames={Math.round(0.05 * fps)} width={CONTENT.width} />
          ) : null}
          {hasChart ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <DataViz
                chart={chart}
                palette={palette}
                frame={frame}
                fps={fps}
                width={CONTENT.width}
                height={760}
                delayFrames={Math.round(0.35 * fps)}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
              <Deck text={scene.subtext || ""} palette={palette} frame={frame} fps={fps} maxWidth={CONTENT.width} delayFrames={Math.round(0.3 * fps)} />
            </div>
          )}
        </div>
      </SafeBox>
    </SceneShell>
  );
}

export function Timeline(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const events = scene.components.filter((c) => Boolean(c.label));
  const headline = scene.headline || "";
  const per = Math.max(0.5, props.durationInFrames / fps / Math.max(1, events.length + 0.5));
  const trackTop = 420;
  const railD = `M ${CONTENT.left} ${trackTop} L ${CONTENT.left + CONTENT.width} ${trackTop}`;
  return (
    <SceneShell {...props}>
      <SafeBox style={{ paddingTop: SPACE.lg }}>
        {headline ? (
          <Eyebrow text={headline} palette={palette} frame={frame} fps={fps} delayFrames={Math.round(0.05 * fps)} width={CONTENT.width} />
        ) : null}
        <div style={{ flex: 1, position: "relative", marginTop: SPACE.xl }}>
          <svg width={CONTENT.width} height={1100} style={{ overflow: "visible" }}>
            <path
              d={railD}
              fill="none"
              stroke={palette.lineStrong}
              strokeWidth={2}
              strokeDasharray={CONTENT.width}
              strokeDashoffset={CONTENT.width * (1 - ease("cubic_out", Math.min(1, frame / Math.round(0.8 * fps))))}
            />
            {events.map((event, i) => {
              const start = Math.round((0.5 + i * per) * fps);
              const t = Math.max(0, Math.min(1, (frame - start) / Math.round(0.45 * fps)));
              const e = ease("expo_out", t);
              const y = trackTop + 90 + i * 150;
              const x = CONTENT.left + CONTENT.width * 0.5;
              if (e <= 0) return null;
              return (
                <g key={event.label + i} opacity={e}>
                  <line x1={x} y1={trackTop} x2={x} y2={y - 30} stroke={palette.line} strokeWidth={1.6} />
                  <circle cx={x} cy={trackTop} r={7} fill={palette.accent} />
                  <text
                    x={x + 34}
                    y={y}
                    fontFamily={FONTS.text}
                    fontSize={34}
                    fontWeight={600}
                    letterSpacing={0.4}
                    fill={palette.ink}
                  >
                    {event.label}
                  </text>
                  {event.emphasis !== "normal" ? (
                    <Bracket
                      palette={palette}
                      frame={frame}
                      fps={fps}
                      x={x + 22}
                      y={y - 40}
                      w={Math.max(120, event.label.length * 20)}
                      h={54}
                      side="left"
                      seed={seed + i}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </SafeBox>
    </SceneShell>
  );
}

export function Conclusion(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const headline = scene.headline || scene.beats[0]?.text || scene.narration;
  const cta = scene.components[0]?.label || "";
  const ruleT = Math.max(0, Math.min(1, (frame - Math.round(0.9 * fps)) / Math.round(0.5 * fps)));
  const e = ease("cubic_out", ruleT);
  return (
    <SceneShell {...props} background={palette.paperCool}>
      <SafeBox justify="center" align="center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.lg }}>
          <Headline
            text={headline}
            palette={palette}
            frame={frame}
            fps={fps}
            maxWidth={CONTENT.width * 0.94}
            maxLines={4}
            maxSize={78}
            align="center"
            seed={seed}
          />
          <svg width={CONTENT.width * 0.34} height={12} style={{ opacity: e }}>
            <MeasuredRule palette={palette} width={CONTENT.width * 0.34 * Math.min(1, e * 1.15)} x={0} y={6} tick={12} />
          </svg>
          {cta ? (
            <div
              style={{
                fontFamily: FONTS.text,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: 2.6,
                textTransform: "uppercase",
                color: palette.accent,
                opacity: Math.min(1, Math.max(0, (frame - Math.round(1.2 * fps)) / Math.round(0.5 * fps))),
              }}
            >
              {cta}
            </div>
          ) : null}
        </div>
      </SafeBox>
      {/* The video ends on the brand. The call to action is the last thing said and
          the wordmark is the last thing seen: a video that ends on its footnote is a
          video that ends on a technicality, and a publisher's handle is where the
          follow lives. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 150,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
          opacity: Math.min(1, Math.max(0, (frame - Math.round(1.5 * fps)) / Math.round(0.5 * fps))),
        }}
      >
        <span style={{ fontFamily: FONTS.eyebrow, fontSize: 30, fontWeight: 700, letterSpacing: 5.4, color: palette.ink }}>
          HEALTHOS
        </span>
        <span style={{ width: 44, height: 1.6, background: palette.lineStrong }} />
        <span style={{ fontFamily: FONTS.text, fontSize: 23, color: palette.inkMuted }}>
          evidence first, then the video
        </span>
      </div>
    </SceneShell>
  );
}

/**
 * The end card. Legal wording, the source, and the wordmark, and nothing else.
 *
 * This scene is given real time — the orchestrator reserves it in the timeline —
 * because a disclaimer that appears and is immediately cut is the single worst
 * thing that can happen to a health video. The type is the smallest in the system
 * and the frame is the emptiest, which is the correct register.
 */
export function Disclaimer(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  // The disclaimer text is the scene's job, and a legal line that exists only in
  // the audio is not a disclaimer: it is unlabelled narration. The storyboard
  // usually leaves `subtext` empty for a caveat and puts the line in the
  // narration, so the narration is the fallback rather than an empty frame.
  const body = scene.subtext || scene.narration || scene.beats[0]?.text || "";
  const headline = scene.headline || "";
  const t = Math.max(0, Math.min(1, frame / Math.round(0.8 * fps)));
  const e = ease("cubic_out", t);
  const ruleD = handPath(`M ${CONTENT.left} ${0} L ${CONTENT.left + 180} ${0}`, { seed, roughness: 1.2, samples: 20 });
  const rule = drawPath(ruleD, { frame, fps, durationInFrames: Math.round(0.5 * fps), easing: "expo_out" });
  const figure = primaryFigure(scene);

  return (
    <SceneShell {...props} background={palette.paperCool}>
      <SafeBox justify="flex-end" style={{ paddingBottom: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md, opacity: e }}>
          <svg width={200} height={8}>
            <path
              d={ruleD}
              fill="none"
              stroke={palette.accent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={rule.dashArray}
              strokeDashoffset={rule.dashOffset}
            />
          </svg>
          {headline ? (
            <div style={{ fontFamily: TYPE.disclaimer.fontFamily, fontSize: 34, lineHeight: 1.28, color: palette.ink, maxWidth: CONTENT.width * 0.94 }}>
              {headline}
            </div>
          ) : null}
          {body ? (
            <div style={{ fontFamily: TYPE.disclaimer.fontFamily, fontSize: TYPE.disclaimer.fontSize, lineHeight: 1.5, color: palette.inkMuted, maxWidth: CONTENT.width * 0.94 }}>
              {body}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              marginTop: SPACE.sm,
              opacity: Math.min(1, Math.max(0, (frame - Math.round(0.7 * fps)) / Math.round(0.5 * fps))),
            }}
          >
            <span style={{ fontFamily: FONTS.text, fontSize: 24, fontWeight: 700, letterSpacing: 3.4, color: palette.ink }}>
              HEALTHOS
            </span>
            <span style={{ width: 40, height: 1.4, background: palette.lineStrong }} />
            <span style={{ fontFamily: FONTS.text, fontSize: 22, color: palette.inkMuted }}>
              evidence first, then the video
            </span>
          </div>
        </div>
      </SafeBox>
      {figure ? (
        <div style={{ position: "absolute", right: -60, top: 240, opacity: 0.16 }}>
          <Anatomy
            name={figure}
            palette={palette}
            width={420}
            seed={seed}
            frame={frame}
            fps={fps}
            durationInFrames={Math.round(1.2 * fps)}
            labels="never"
            detail={false}
          />
        </div>
      ) : null}
      {/* No full-bleed bar and no scene id. The bottom of the frame belongs to the
          platform's own handle and progress bar, so a decorative rule painted there
          reads as interface, and a burned-in scene id is an internal identifier in a
          published video. The frame inspector is right to flag both. */}
    </SceneShell>
  );
}
