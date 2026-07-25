export type ThemeName = "open" | "sealed";

export type RgbaToken = [number, number, number, number];

type TokenName =
  | "bg"
  | "ink"
  | "inkSoft"
  | "line"
  | "fill"
  | "chapWarm"
  | "chapCool"
  | "chapAlert";

export const THEME_TOKENS: Record<TokenName, Record<ThemeName, RgbaToken>> = {
  bg: { open: [243, 239, 230, 1], sealed: [5, 6, 10, 1] },
  ink: { open: [35, 32, 27, 1], sealed: [242, 239, 232, 1] },
  inkSoft: { open: [48, 44, 37, 0.66], sealed: [232, 227, 216, 0.6] },
  line: { open: [48, 44, 37, 0.26], sealed: [232, 227, 216, 0.28] },
  fill: { open: [255, 255, 255, 0.34], sealed: [255, 255, 255, 0.04] },
  chapWarm: { open: [150, 112, 40, 0.92], sealed: [214, 168, 96, 0.8] },
  chapCool: { open: [48, 88, 168, 0.9], sealed: [150, 184, 255, 0.84] },
  // Reserved for one thing only: a rejected verdict. Nothing decorative on
  // the page may use it, so red always means "the chain said no".
  chapAlert: { open: [168, 52, 40, 0.92], sealed: [232, 116, 96, 0.88] },
};

export function rgbaCss(token: RgbaToken): string {
  const [r, g, b, a] = token;
  return `rgba(${r},${g},${b},${a})`;
}

export function cssVarsFor(theme: ThemeName): Record<string, string> {
  return {
    "--bg": rgbaCss(THEME_TOKENS.bg[theme]),
    "--ink": rgbaCss(THEME_TOKENS.ink[theme]),
    "--ink-soft": rgbaCss(THEME_TOKENS.inkSoft[theme]),
    "--line": rgbaCss(THEME_TOKENS.line[theme]),
    "--fill": rgbaCss(THEME_TOKENS.fill[theme]),
    "--chap-warm": rgbaCss(THEME_TOKENS.chapWarm[theme]),
    "--chap-cool": rgbaCss(THEME_TOKENS.chapCool[theme]),
    "--chap-alert": rgbaCss(THEME_TOKENS.chapAlert[theme]),
  };
}
