/**
 * Backend-local error types.
 *
 * The CLI core imported `ConflictError` from `../cli/errors.js`; the desktop
 * backend must not depend on the CLI layer, so the class lives here with the
 * exact same shape (name, message, expected/actual version fields).
 */
export class ConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(name: string, expectedVersion: number, actualVersion: number) {
    super(
      `Conflict detected on '${name}': secret is currently at v${actualVersion}, but expected v${expectedVersion}.` +
        `\nSomeone else (or another session) may have modified it. Force override not available in the desktop UI.`
    );
    this.name = 'ConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** Thrown when the signed-in user has no vault yet (set up first on the web app). */
export class VaultNotInitializedError extends Error {
  constructor() {
    super('Vault is not initialized. Please set up your vault on the Scync web app first.');
    this.name = 'VaultNotInitializedError';
  }
}

/** Thrown when the master password does not verify against the vault verifier. */
export class VaultLockedError extends Error {
  constructor(message = 'Incorrect master password.') {
    super(message);
    this.name = 'VaultLockedError';
  }
}
