const base = {
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

export const TOKENS: { light: Record<string, string>; dark: Record<string, string> } = {
  light: {
    ...base,
    bg: '#fafbfd',
    surface: '#ffffff',
    border: '#dfe7f0',
    ink: '#1d2433',
    muted: '#5d687a',
    accent: '#0074d9',
    'on-accent': '#ffffff',
    bad: '#c8352f',
    good: '#23704e',
    play: '#1d2433',
  },
  dark: {
    ...base,
    bg: '#131820',
    surface: '#1c2330',
    border: '#2a3343',
    ink: '#e9eef6',
    muted: '#9aa6b8',
    accent: '#4da3f0',
    'on-accent': '#0b1220',
    bad: '#ee5d57',
    good: '#5cc48f',
    play: '#6b778c',
  },
};

export const HUD = { wide: 880, panel: 376, pad: 16, chips: 52, sheet: 236, tall: 760 };
