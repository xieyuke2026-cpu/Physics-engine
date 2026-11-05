/* icons.js — unified SVG icon set. One stroke width (1.7), 24px grid, round caps.
   No emoji are used as functional icons anywhere in MotionLab. */

const PATHS = {
  logo: '<circle cx="12" cy="12" r="2.1"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(-24 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(52 12 12)"/>',
  undo: '<path d="M8.5 5.5 4.5 9.5l4 4"/><path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3"/>',
  redo: '<path d="m15.5 5.5 4 4-4 4"/><path d="M19.5 9.5H9a4.5 4.5 0 0 0 0 9h3"/>',
  play: '<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10-6.8c.6-.4.6-1.3 0-1.7l-10-6.8C8.9 4 8 4.4 8 5.2Z"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
  reset: '<path d="M4.5 9.5A8 8 0 1 1 4 14.5"/><path d="M4.2 4.8v4.7h4.7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  code: '<path d="M8.2 6.8 3.4 12l4.8 5.2M15.8 6.8l4.8 5.2-4.8 5.2"/>',
  cube: '<path d="M12 3.2 19.5 7.4v9.2L12 20.8l-7.5-4.2V7.4Z"/><path d="M12 12.2 19.5 7.4M12 12.2 4.5 7.4M12 12.2v8.6"/>',
  select: '<path d="M6 3.8 18.2 12c.5.3.4 1-.1 1.2l-5 1.7-2.2 4.8c-.3.6-1.2.5-1.4-.1L6 4.6c-.2-.6.4-1.1 1-.8Z"/>',
  move: '<path d="M12 3v18M3 12h18M12 3 9.2 5.8M12 3l2.8 2.8M12 21l-2.8-2.8M12 21l2.8-2.8M3 12l2.8-2.8M3 12l2.8 2.8M21 12l-2.8-2.8M21 12l-2.8 2.8"/>',
  circle: '<circle cx="12" cy="12" r="8.2"/>',
  rectangle: '<rect x="3.8" y="6.5" width="16.4" height="11" rx="1"/>',
  polygon: '<path d="M12 3.5 19.8 8v8L12 20.5 4.2 16V8Z"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6V4.2c0-.6.4-1 1-1h3c.6 0 1 .4 1 1V6M6.5 6.5l.8 12c.1.8.7 1.3 1.5 1.3h6.4c.8 0 1.4-.5 1.5-1.3l.8-12M10 10.5v6M14 10.5v6"/>',
  save: '<path d="M5 3.8h11L20.2 8v11a1.2 1.2 0 0 1-1.2 1.2H5A1.2 1.2 0 0 1 3.8 19V5A1.2 1.2 0 0 1 5 3.8Z"/><path d="M7.5 3.8V9h8V3.8M7.5 20.2v-6h9v6"/>',
  export: '<path d="M12 15V3.5M12 3.5 8.2 7.3M12 3.5l3.8 3.8"/><path d="M4.5 13.5v6A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
  import: '<path d="M12 3.5V15M12 15l3.8-3.8M12 15 8.2 11.2"/><path d="M4.5 13.5v6A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
  share: '<circle cx="6" cy="12" r="2.6"/><circle cx="17.5" cy="5.5" r="2.6"/><circle cx="17.5" cy="18.5" r="2.6"/><path d="M8.3 10.8 15.2 6.7M8.3 13.2l6.9 4.1"/>',
  folder: '<path d="M3.8 6.2A1.2 1.2 0 0 1 5 5h4l2 2.4h7.8a1.2 1.2 0 0 1 1.2 1.2V18a1.2 1.2 0 0 1-1.2 1.2H5A1.2 1.2 0 0 1 3.8 18Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.2"/><path d="M5 15H4.2A1.2 1.2 0 0 1 3 13.8v-9A1.2 1.2 0 0 1 4.2 3.6h9A1.2 1.2 0 0 1 14.4 4.8V5"/>',
  edit: '<path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17Z"/><path d="m14.5 7 3 3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.2"/><path d="M15 4.5v15"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  spring: '<path d="M2.5 12h2.2l1.6-4.5 2.1 9 2.1-9 2.1 9 2.1-9 2.1 9 1.6-4.5h3.1"/>',
  burst: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  gamepad: '<rect x="2.5" y="7.5" width="19" height="10" rx="5"/><path d="M8 10.8v3.4M6.3 12.5h3.4"/><circle cx="15.8" cy="11.6" r="0.4" fill="currentColor"/><circle cx="18" cy="13.8" r="0.4" fill="currentColor"/>',
  triangle: '<path d="M12 4.2 20.3 19.5H3.7Z"/>',
  step: '<path d="M6.5 5.8v12.4L15 12Z"/><path d="M17.5 5.5v13"/>',
  camera: '<rect x="3.5" y="7.5" width="17" height="12" rx="1.2"/><circle cx="12" cy="13.5" r="3.4"/><path d="M9 7.5 10.4 5h3.2L15 7.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  flip: '<path d="M4 8.5h13M13.5 4.8 17.2 8.5l-3.7 3.7M20 15.5H7M10.5 11.8 6.8 15.5l3.7 3.7"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="1.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  layers: '<path d="m12 3.8 8.5 4.7L12 13.2 3.5 8.5Z"/><path d="m4.8 12.8 7.2 4 7.2-4M4.8 16.8l7.2 4 7.2-4"/>',
  magnet: '<path d="M6.5 4v6.5a5.5 5.5 0 0 0 11 0V4"/><path d="M6.5 4h3.6M13.9 4h3.6M6.5 7.8h3.6M13.9 7.8h3.6"/>',
  record: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
  hinge: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/><path d="M12 9.4V4.8M12 19.2v-4.6M9.8 10.2 5.6 6.9M14.2 13.8l4.2 3.3M10.2 14.2l-3.3 4.2M13.8 9.8l3.3-4.2"/>',
};

export function icon(name, size = 20) {
  const inner = PATHS[name];
  if (!inner) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const TOOL_ICONS = {
  select: 'select', move: 'move', circle: 'circle', rectangle: 'rectangle',
  polygon: 'polygon', triangle: 'triangle', line: 'line', magnet: 'magnet', spring: 'spring', hinge: 'hinge', blast: 'burst', delete: 'trash',
};
export const TOOL_LABELS = {
  select: '选择', move: '移动', circle: '圆形', rectangle: '矩形',
  polygon: '多边形', triangle: '三角形', line: '线段', magnet: '磁铁', spring: '弹簧', hinge: '铰链', blast: '冲击波', delete: '删除',
};
