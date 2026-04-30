export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export class ForeignKeyError extends Error {
  constructor(public readonly target: string) {
    super(`${target} not found`);
    this.name = 'ForeignKeyError';
  }
}
