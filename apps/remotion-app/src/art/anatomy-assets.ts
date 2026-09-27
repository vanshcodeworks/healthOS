/**
 * Rights-checked anatomy assets.
 *
 * Real anatomical illustrations, retrieved from Wikimedia Commons, all public
 * domain, attribution recorded in `public/anatomy/manifest.json`. A figure named
 * here renders as the real illustration; a figure that is not renders as the
 * procedural drawing in `anatomy/figures`, and the adapter notes the difference.
 *
 * `labelled` records whether the illustration carries its own printed labels. A
 * labelled illustration is the label: drawing the renderer's own labels on top of
 * the NIH's printing is two sets of names for one drawing, so the procedural
 * labels are skipped when the image carries its own.
 */

export interface AnatomyAsset {
  /** File name inside the Remotion `public/anatomy` directory. */
  file: string;
  /** The illustration has its own printed labels. */
  labelled: boolean;
  /** Native pixel size, for the aspect ratio the display size follows. */
  width: number;
  height: number;
}

export const ANATOMY_ASSETS: Record<string, AnatomyAsset> = {
  brain: { file: "brain.svg", labelled: false, width: 411.67, height: 330.02 },
  heart: { file: "heart.svg", labelled: true, width: 431, height: 615 },
  lungs: { file: "lungs.svg", labelled: true, width: 512, height: 545 },
  stomach: { file: "stomach.svg", labelled: true, width: 255, height: 255 },
  intestine: { file: "intestine.svg", labelled: false, width: 595, height: 842 },
  kidney: { file: "kidney.svg", labelled: false, width: 512, height: 582 },
  neuron: { file: "neuron.svg", labelled: false, width: 819, height: 596 },
  cell: { file: "cell.svg", labelled: true, width: 512, height: 342 },
  receptor: { file: "receptor.svg", labelled: false, width: 500, height: 500 },
};

export function anatomyAssetFor(name: string): AnatomyAsset | undefined {
  return ANATOMY_ASSETS[name];
}
