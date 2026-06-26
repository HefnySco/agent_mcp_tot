/**
 * Input validation utilities for ToT MCP Server
 * Provides validation functions for tool parameters
 */

import { ToTError } from '../types.js';

export class ValidationError extends ToTError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate that a required string field is present and non-empty
 */
export function validateRequiredString(value: any, fieldName: string): void {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  if (value.trim() === '') {
    throw new ValidationError(`${fieldName} cannot be empty`);
  }
}

/**
 * Validate that a number is within a specified range
 */
export function validateNumberRange(value: any, fieldName: string, min: number, max: number): void {
  if (typeof value !== 'number') {
    throw new ValidationError(`${fieldName} must be a number`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max}`);
  }
}

/**
 * Validate that a number is at least a minimum value
 */
export function validateMinNumber(value: any, fieldName: string, min: number): void {
  if (typeof value !== 'number') {
    throw new ValidationError(`${fieldName} must be a number`);
  }
  if (value < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`);
  }
}

/**
 * Validate that a value is one of the allowed enum values
 */
export function validateEnum(value: any, fieldName: string, allowedValues: string[]): void {
  if (!allowedValues.includes(value)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
  }
}

/**
 * Validate optional sessionId if provided
 */
export function validateSessionId(sessionId: any): void {
  if (sessionId !== undefined) {
    validateRequiredString(sessionId, 'sessionId');
  }
}

/**
 * Validate evaluation score (0-100)
 */
export function validateEvaluationScore(score: number): void {
  validateNumberRange(score, 'score', 0, 100);
}
