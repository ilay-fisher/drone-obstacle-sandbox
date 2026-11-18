/**
 * An error whose status code, machine code and message are safe to show to API clients.
 * Anything that is not an AppError is treated as an internal fault and masked.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 404 for a missing resource. */
export class NotFoundError extends AppError {
  constructor(what: string) {
    super(404, 'not_found', `${what} not found`);
  }
}
