export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export class ForeignKeyError extends Error {
  readonly statusCode = 400;
  constructor(public readonly target: string) {
    super(`${target} not found`);
    this.name = 'ForeignKeyError';
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
