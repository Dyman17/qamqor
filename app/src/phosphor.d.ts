// Per-icon deep imports keep the bundle small (no tree-shaking of the package barrel in Metro).
// The package ships types only for its barrel, so declare the few icons used here.
declare module 'phosphor-react-native/lib/module/icons/*' {
  import type { Icon } from 'phosphor-react-native';
  export const Gear: Icon;
  export const ArrowLeft: Icon;
  export const MapTrifold: Icon;
  export const Cow: Icon;
  export const Bell: Icon;
  export const Broadcast: Icon;
}
