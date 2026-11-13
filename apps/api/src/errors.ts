import type { FastifyReply } from 'fastify';

/** The one error shape of the API (docs/02 §6): `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendError(reply: FastifyReply, error: ApiError): FastifyReply {
  return reply.status(error.status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}
