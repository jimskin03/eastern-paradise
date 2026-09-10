export class EpistemicError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EpistemicError';
    this.code = code;
    this.status = status;
  }
}

