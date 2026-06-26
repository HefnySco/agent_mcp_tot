/**
 * Logger utility for ToT MCP Server
 * Provides consistent logging with prefixes for different components
 */

export const logger = {
  info: (message: string) => console.log(`[ToTServer] ${message}`),
  error: (message: string) => console.error(`[ToTServer] ${message}`),
  warn: (message: string) => console.warn(`[ToTServer] ${message}`)
};

export const serviceLogger = {
  info: (message: string) => console.log(`[ToTService] ${message}`),
  error: (message: string) => console.error(`[ToTService] ${message}`),
  warn: (message: string) => console.warn(`[ToTService] ${message}`)
};
