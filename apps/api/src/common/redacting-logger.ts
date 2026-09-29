import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { redactValue } from './redact';

/**
 * The application logger: Nest's console logger with every message passed through redaction first.
 * Used by main.ts and by the HTTP test harness, so the tests exercise the same logger as production.
 */
export class RedactingLogger extends ConsoleLogger {
  constructor(levels?: LogLevel[]) {
    super();
    if (levels) this.setLogLevels(levels);
  }

  log(message: unknown, ...rest: unknown[]) {
    super.log(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
  error(message: unknown, ...rest: unknown[]) {
    super.error(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
  warn(message: unknown, ...rest: unknown[]) {
    super.warn(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
  debug(message: unknown, ...rest: unknown[]) {
    super.debug(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
  verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
  fatal(message: unknown, ...rest: unknown[]) {
    super.fatal(redactValue(message), ...rest.map((r) => redactValue(r)));
  }
}
