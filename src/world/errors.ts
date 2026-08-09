export class LevelValidationError extends Error {
  public constructor(message: string) { super(`LevelValidationError: ${message}`); this.name = 'LevelValidationError'; }
}
