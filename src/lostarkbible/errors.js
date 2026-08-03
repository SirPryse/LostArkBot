export class TokenExpiredError extends Error {
  constructor(message = 'lostark.bible access token is invalid or expired') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

export class InsufficientScopeError extends Error {
  constructor(message = 'lostark.bible token is missing a required scope') {
    super(message);
    this.name = 'InsufficientScopeError';
  }
}
