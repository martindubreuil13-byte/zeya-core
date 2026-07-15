export class RepresentationNotFoundError extends Error {
  constructor() {
    super('Representation not found');
    this.name = 'RepresentationNotFoundError';
  }
}

export class RepresentationConflictError extends Error {
  constructor(message = 'Representation conflict') {
    super(message);
    this.name = 'RepresentationConflictError';
  }
}

export class RepresentationInvalidInputError extends Error {
  constructor(message = 'Invalid representation input') {
    super(message);
    this.name = 'RepresentationInvalidInputError';
  }
}

export function isRepresentationNotFoundError(error: unknown): boolean {
  return error instanceof RepresentationNotFoundError;
}

export function isRepresentationConflictError(error: unknown): boolean {
  return error instanceof RepresentationConflictError;
}

export function isRepresentationInvalidInputError(error: unknown): boolean {
  return error instanceof RepresentationInvalidInputError;
}
