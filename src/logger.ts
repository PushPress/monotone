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

  /**
   * Check if a given log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;

  /**
   * Get the current log level
   */
  getLevel(): LogLevel;

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void;
}

/**
 * Type guard to check if an object implements the Logger interface
 */
export function isLogger(obj: unknown): obj is Logger {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const logger = obj as Record<string, unknown>;

  return (
    typeof logger.trace === 'function' &&
    typeof logger.debug === 'function' &&
    typeof logger.info === 'function' &&
    typeof logger.warn === 'function' &&
    typeof logger.error === 'function' &&
    typeof logger.fatal === 'function' &&
    typeof logger.child === 'function' &&
    typeof logger.isLevelEnabled === 'function' &&
    typeof logger.getLevel === 'function' &&
    typeof logger.setLevel === 'function'
  );
}

/**
 * Utility function to create a logger adapter that wraps any logger
 * to ensure it conforms to the Logger interface
 */
export function createLoggerAdapter(logger: unknown): Logger {
  if (isLogger(logger)) {
    return logger;
  }

  // If it's not a Logger, we'll create a minimal adapter
  // This assumes the logger has the standard methods but might not implement our interface
  const adaptedLogger = logger as Record<string, unknown>;

  const adapter: Logger = {
    trace: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.trace === 'function') {
        adaptedLogger.trace(contextOrMessage, message);
      }
    },
    debug: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.debug === 'function') {
        adaptedLogger.debug(contextOrMessage, message);
      }
    },
    info: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.info === 'function') {
        adaptedLogger.info(contextOrMessage, message);
      }
    },
    warn: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.warn === 'function') {
        adaptedLogger.warn(contextOrMessage, message);
      }
    },
    error: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.error === 'function') {
        adaptedLogger.error(contextOrMessage, message);
      }
    },
    fatal: (contextOrMessage: LogContext | string, message?: string) => {
      if (typeof adaptedLogger.fatal === 'function') {
        adaptedLogger.fatal(contextOrMessage, message);
      } else if (typeof adaptedLogger.error === 'function') {
        // Fallback to error if fatal is not available
        adaptedLogger.error(contextOrMessage, message);
      }
    },
    child: (context: LogContext) => {
      if (typeof adaptedLogger.child === 'function') {
        return createLoggerAdapter(adaptedLogger.child(context));
      }
      // If child is not available, return a new adapter with context
      return createLoggerAdapter({
        ...adaptedLogger,
        context: { ...(adaptedLogger.context as LogContext), ...context },
      });
    },
    isLevelEnabled: (level: LogLevel) => {
      if (typeof adaptedLogger.isLevelEnabled === 'function') {
        return adaptedLogger.isLevelEnabled(level);
      }
      // Default to true if not available
      return true;
    },
    getLevel: () => {
      if (typeof adaptedLogger.getLevel === 'function') {
        return adaptedLogger.getLevel() as LogLevel;
      }
      return 'info';
    },
    setLevel: (level: LogLevel) => {
      if (typeof adaptedLogger.setLevel === 'function') {
        adaptedLogger.setLevel(level);
      }
    },
  };

  return adapter;
}