// Tiny zero-dependency ANSI color helper.
// Respects NO_COLOR (https://no-color.org) and non-TTY output.

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

function wrap(open, close) {
  return (s) => (enabled ? `[${open}m${s}[${close}m` : String(s));
}

export const color = {
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

// Status glyphs used across the report.
export const glyph = {
  pass: () => color.green('✓'),
  warn: () => color.yellow('!'),
  fail: () => color.red('✗'),
  info: () => color.cyan('•'),
};
