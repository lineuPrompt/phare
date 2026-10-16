import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { appleDeps, AppleNotConfiguredError, privateKeyFrom } from '../appleConfig';
import { appleRootCertificates } from '../appleRootCertificates';

describe('the embedded Apple root certificates', () => {
  it('are the published Apple roots, byte for byte (SHA-256 fingerprints)', () => {
    const [g3, g2] = appleRootCertificates().map((der) => new X509Certificate(der));
    expect(g3.subject).toContain('CN=Apple Root CA - G3');
    expect(g3.fingerprint256).toBe('63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79');
    expect(g2.subject).toContain('CN=Apple Root CA - G2');
    expect(g2.fingerprint256).toBe('C2:B9:B0:42:DD:57:83:0E:7D:11:7D:AC:55:AC:8A:E1:94:07:D3:8E:41:D8:8F:32:15:BC:3A:89:04:44:A0:50');
  });

  it('are accepted by Apple’s verifier', () => {
    expect(() => new SignedDataVerifier(appleRootCertificates(), true, Environment.PRODUCTION, 'money.phare.app', 6812001209)).not.toThrow();
  });
});

describe('appleDeps configuration', () => {
  it('names every missing variable instead of failing on the first use', () => {
    try {
      appleDeps({ APPLE_BUNDLE_ID: 'money.phare.app' });
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppleNotConfiguredError);
      expect((err as Error).message).toBe(
        'Apple in-app purchase is not configured: missing APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY, APPLE_APP_APPLE_ID'
      );
    }
  });

  it('treats a blank variable as missing', () => {
    expect(() => appleDeps({
      APPLE_IAP_KEY_ID: ' ', APPLE_IAP_ISSUER_ID: 'i', APPLE_IAP_PRIVATE_KEY: 'k', APPLE_BUNDLE_ID: 'b', APPLE_APP_APPLE_ID: '1',
    })).toThrow('missing APPLE_IAP_KEY_ID');
  });
});

describe('privateKeyFrom', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----';

  it('takes the .p8 contents as they are', () => {
    expect(privateKeyFrom(`  ${pem}\n`)).toBe(pem);
  });

  it('restores line breaks pasted as \\n into a single-line variable', () => {
    expect(privateKeyFrom(pem.replace(/\n/g, '\\n'))).toBe(pem);
  });

  it('takes the whole file base64-encoded', () => {
    expect(privateKeyFrom(Buffer.from(pem + '\n').toString('base64'))).toBe(pem);
  });
});
