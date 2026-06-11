// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Global error handler — translates exceptions into RFC 7807-style JSON.
 *
 * Convention:
 *   - 4xx errors are "expected" (bad input, not found, etc.) — log as warn
 *   - 5xx errors are "unexpected" (bug, DB down, etc.) — log as error
 *
 * Zod validation errors are handled by fastify-type-provider-zod
 * separately and converted to 400 Bad Request with field-level details.
 *
 * In production, 5xx errors hide internal details from clients.
 */

import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Custom error classes — services throw these, handler translates to HTTP.
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(resource: string, id?: string) {
    super(404, id ? `${resource} not found: ${id}` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication required') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Insufficient permissions') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * FastifyError-like shape — Fastify built-in errors (validation, payload too
 * large, etc.) carry an optional `statusCode` and a `name`/`message`. We
 * use a narrow shape here instead of importing FastifyError to avoid coupling.
 */
interface FastifyErrorLike extends Error {
  statusCode?: number;
}

function hasStatusCode(err: unknown): err is FastifyErrorLike {
  return (
    err instanceof Error &&
    'statusCode' in err &&
    typeof (err as FastifyErrorLike).statusCode === 'number'
  );
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : 'Unknown error');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((rawError, request, reply) => {
    const error = toError(rawError);
    const isProd = fastify.config.NODE_ENV === 'production';

    // ----- Zod validation error (from fastify-type-provider-zod) -----
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues, path: request.url }, 'Validation failed');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request validation failed',
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    // ----- Custom HttpError -----
    if (error instanceof HttpError) {
      request.log.warn(
        { statusCode: error.statusCode, message: error.message, path: request.url },
        'Application error',
      );
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name.replace(/Error$/, ''),
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    // ----- Fastify built-in errors (e.g. payload too large) -----
    if (hasStatusCode(error) && error.statusCode && error.statusCode < 500) {
      request.log.warn(
        { statusCode: error.statusCode, message: error.message, path: request.url },
        'Client error',
      );
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name || 'Error',
        message: error.message,
      });
    }

    // ----- Unexpected 5xx error -----
    request.log.error({ err: error, path: request.url }, 'Unexpected error');
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: isProd ? 'An internal error occurred' : error.message,
      ...(isProd ? {} : { stack: error.stack }),
    });
  });

  // ----- 404 handler for unknown routes -----
  fastify.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });
};

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
  dependencies: ['config'],
});
