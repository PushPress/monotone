/**
 * Generic logging interface that can be satisfied by popular logging libraries
 * like Pino, Bunyan, Winston, and others.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp?: string | number;
  [key: string]: unknown;
}

/**
 * Generic logger interface that provides a consistent API across different
 * logging implementations. Supports both Pino-style (context first) and
 * traditional (message first) signatures.
 */
export interface Logger {
  /**
   * Log a message at trace level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  trace(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Log a message at debug level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  debug(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Log a message at info level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  info(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Log a message at warn level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  warn(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Log a message at error level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  error(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Log a message at fatal level
   * @param contextOrMessage - Context object (Pino-style) or message string (traditional)
   * @param message - Message string (when context is provided first)
   */
  fatal(contextOrMessage: LogContext | string, message?: string): void;

  /**
   * Create a child logger with additional context that will be included
   * in all log messages from this child logger.
   */
  child(context: LogContext): Logger;
}

