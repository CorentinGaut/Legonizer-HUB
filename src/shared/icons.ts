/**
 * Icon sprite (./icons.svg, 68 symbols drawn for this project) inlined once per page, and a
 * helper that returns the `<svg><use></svg>` markup. Icons are decorative (`aria-hidden`); give the
 * surrounding control an accessible name.
 */
import sprite from './icons.svg?raw';

export type IconName =
  | 'upload'
  | 'download'
  | 'file'
  | 'folder'
  | 'link'
  | 'check'
  | 'check-circle'
  | 'x'
  | 'x-circle'
  | 'warning'
  | 'info'
  | 'help'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-left'
  | 'arrow-right'
  | 'first'
  | 'last'
  | 'play'
  | 'pause'
  | 'copy'
  | 'rotate'
  | 'refresh'
  | 'undo'
  | 'view-top'
  | 'view-3d'
  | 'fullscreen'
  | 'fullscreen-exit'
  | 'north'
  | 'keyboard'
  | 'keypad'
  | 'qr'
  | 'table'
  | 'layers'
  | 'plus'
  | 'minus'
  | 'menu'
  | 'more'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'external'
  | 'eye'
  | 'eye-off'
  | 'target'
  | 'fit'
  | 'draw-area'
  | 'save'
  | 'folder-open'
  | 'lock'
  | 'share'
  | 'print'
  | 'grid'
  | 'tag'
  | 'ruler'
  | 'brick'
  | 'clock'
  | 'archive'
  | 'sliders'
  | 'cube-off'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-view'
  | 'pin'
  | 'users'
  | 'projector';

const SPRITE_ID = 'lz-icon-sprite';

/** Insert the sprite at the start of `<body>` (idempotent). */
export function ensureIconSprite(doc: Document = document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const holder = doc.createElement('div');
  holder.id = SPRITE_ID;
  // Not `hidden`: <use> must reach the symbols; the sprite's own style makes it 0 × 0.
  holder.innerHTML = sprite;
  doc.body.prepend(holder);
}

/** Markup for an icon; `size` maps to `.lz-icon--sm|lg|xl`. */
export function icon(name: IconName, opts: { size?: 'sm' | 'lg' | 'xl'; className?: string } = {}): string {
  const cls = ['lz-icon', opts.size ? `lz-icon--${opts.size}` : '', opts.className ?? '']
    .filter(Boolean)
    .join(' ');
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}
