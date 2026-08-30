/**
 * Central chalk theme — every command prints through this one palette so the
 * CLI stays visually consistent (ok/warn/error/muted/brand).
 */

import chalk from "chalk";

/** Central chalk theme so CLI output stays consistent. */
export const theme = {
  brand: chalk.bold.cyan,
  title: chalk.bold.white,
  bold: chalk.bold,
  ok: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  muted: chalk.gray,
  info: chalk.blue,
  risk: (level: string): ReturnType<typeof chalk.green> => {
    switch (level) {
      case "low":
        return chalk.green(level);
      case "medium":
        return chalk.yellow(level);
      case "high":
        return chalk.redBright(level);
      case "blocked":
        return chalk.bgRed.white(level);
      default:
        return chalk.white(level);
    }
  },
};
