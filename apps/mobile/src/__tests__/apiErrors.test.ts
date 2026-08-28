import { describe, it, expect } from 'vitest';
import { ApiError, kindForStatus, messageKeyFor } from '../lib/apiErrors';
import en from '../i18n/messages/en.json';
import fr from '../i18n/messages/fr.json';
import { lookup, type Catalog } from '../i18n/catalog';

describe('kindForStatus', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rateLimited'],
    [400, 'server'],
    [413, 'server'],
    [500, 'server'],
    [503, 'server'],
  ])('%i → %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe('messageKeyFor', () => {
  it('maps an ApiError to its kind key', () => {
    expect(messageKeyFor(new ApiError('rateLimited', 429, 'RATE_LIMITED'))).toBe(
      'errors.rateLimited'
    );
  });

  it('maps a non-ApiError to the generic server key', () => {
    // A bug in our own code must not render as "check your connection".
    expect(messageKeyFor(new TypeError('undefined is not a function'))).toBe('errors.server');
    expect(messageKeyFor('a string')).toBe('errors.server');
  });

  it('every kind it can produce has copy in BOTH locales', () => {
    // The bug this catches: adding a fifth ApiErrorKind and forgetting the
    // catalogue entry, which renders the raw key 'errors.whatever' on screen.
    const kinds = ['unauthorized', 'rateLimited', 'network', 'server'] as const;

    for (const kind of kinds) {
      const key = messageKeyFor(new ApiError(kind, null, null));
      expect(lookup(en as Catalog, key), `en missing ${key}`).toBeTruthy();
      expect(lookup(fr as Catalog, key), `fr missing ${key}`).toBeTruthy();
    }
  });
});

describe('ApiError', () => {
  it('keeps the server code for logs without putting it in the UI path', () => {
    const err = new ApiError('server', 413, 'PAYLOAD_TOO_LARGE');
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err.status).toBe(413);
    // messageKeyFor is the only thing a screen calls, and it ignores the code.
    expect(messageKeyFor(err)).toBe('errors.server');
  });

  it('is a real Error subclass so instanceof and stack work', () => {
    const err = new ApiError('network', null, null);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
  });
});
