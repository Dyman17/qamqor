// Phosphor Icons (MIT, https://phosphoricons.com) via @phosphor-icons/core: ONE weight (regular) for the whole site, bundled at build, no runtime CDN.
// Only the icons below are imported. Add a name here to use another one.
import i_map_trifold from '@phosphor-icons/core/assets/regular/map-trifold.svg?raw';
import i_cow from '@phosphor-icons/core/assets/regular/cow.svg?raw';
import i_bell_ringing from '@phosphor-icons/core/assets/regular/bell-ringing.svg?raw';
import i_tag from '@phosphor-icons/core/assets/regular/tag.svg?raw';
import i_gear_six from '@phosphor-icons/core/assets/regular/gear-six.svg?raw';
import i_magnifying_glass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import i_plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import i_minus from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import i_x from '@phosphor-icons/core/assets/regular/x.svg?raw';
import i_check_circle from '@phosphor-icons/core/assets/regular/check-circle.svg?raw';
import i_warning from '@phosphor-icons/core/assets/regular/warning.svg?raw';
import i_warning_circle from '@phosphor-icons/core/assets/regular/warning-circle.svg?raw';
import i_wifi_slash from '@phosphor-icons/core/assets/regular/wifi-slash.svg?raw';
import i_cloud_slash from '@phosphor-icons/core/assets/regular/cloud-slash.svg?raw';
import i_crosshair_simple from '@phosphor-icons/core/assets/regular/crosshair-simple.svg?raw';
import i_corners_out from '@phosphor-icons/core/assets/regular/corners-out.svg?raw';
import i_stack from '@phosphor-icons/core/assets/regular/stack.svg?raw';
import i_caret_down from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import i_arrow_down from '@phosphor-icons/core/assets/regular/arrow-down.svg?raw';
import i_plant from '@phosphor-icons/core/assets/regular/plant.svg?raw';

const RAW: Record<string, string> = {
  'map-trifold': i_map_trifold,
  'cow': i_cow,
  'bell-ringing': i_bell_ringing,
  'tag': i_tag,
  'gear-six': i_gear_six,
  'magnifying-glass': i_magnifying_glass,
  'plus': i_plus,
  'minus': i_minus,
  'x': i_x,
  'check-circle': i_check_circle,
  'warning': i_warning,
  'warning-circle': i_warning_circle,
  'wifi-slash': i_wifi_slash,
  'cloud-slash': i_cloud_slash,
  'crosshair-simple': i_crosshair_simple,
  'corners-out': i_corners_out,
  'stack': i_stack,
  'caret-down': i_caret_down,
  'arrow-down': i_arrow_down,
  'plant': i_plant,
};

/** The inner shapes of a Phosphor svg (everything between <svg ...> and </svg>). */
const inner = (svg: string): string => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
const PATHS: Record<string, string> = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, inner(v)]));

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 24, cls = ''): string {
  const d = PATHS[name];
  if (!d) throw new Error(`unknown icon ${name}`);
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">${d}</svg>`;
}
