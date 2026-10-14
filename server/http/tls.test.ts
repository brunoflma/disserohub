import { describe, expect, it } from 'vitest';
import { tlsConfig } from './tls';

describe('optional HTTPS listener', () => {
  it('keeps installations without TLS configuration on HTTP', () => {
    expect(tlsConfig({})).toBeUndefined();
  });
  it('requires both certificate and key and rejects invalid ports', () => {
    for (const env of [{ HABBLAUD_HTTPS_CERT: 'cert.pem' }, { HABBLAUD_HTTPS_KEY: 'key.pem' },
      ...['0', '65536', 'NaN', '1.5', ''].map(port => ({ HABBLAUD_HTTPS_PORT: port, HABBLAUD_HTTPS_CERT: 'cert.pem' }))]) {
      expect(() => tlsConfig(env)).toThrow();
    }
  });
  it('uses port 443 by default and accepts an explicit testing port', () => {
    const env = { HABBLAUD_HTTPS_CERT: 'cert.pem', HABBLAUD_HTTPS_KEY: 'key.pem' };
    expect(tlsConfig(env)?.port).toBe(443);
    expect(tlsConfig({ ...env, HABBLAUD_HTTPS_PORT: '4443' })?.port).toBe(4443);
  });
});
