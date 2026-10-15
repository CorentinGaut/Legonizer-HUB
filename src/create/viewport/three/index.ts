/** Lazy chunk entry: everything that needs three.js on the page (loaded only with WebGL 2, N5). */
export { ThreeView, disposeTree, type FrameOptions } from './view.ts';
export {
  BRICK_H,
  SourceModel,
  brickGuides,
  buildBrickModel,
  lineSegments,
  plateLabels,
  polygonOutline,
  setStripeWidth,
  studRulers,
  textSprite,
  type BrickState,
  type FeatureFlag,
} from './models.ts';
export { Box3, Group, Matrix4, Vector3 } from 'three';
