'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)});
  res.end(payload);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(privateKey, payload) {
  const header = {alg: 'RS256', typ: 'JWT', kid: 'e2e-key'};
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const input = encodedHeader + '.' + encodedPayload;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return input + '.' + signature;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

async function startFakeOidcProvider(options = {}) {
  const port = options.port || 4568;
  const host = options.host || '127.0.0.1';
  const issuer = 'http://' + host + ':' + port;
  const audience = options.audience || 'j2e-e2e-client';
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = publicKey.export({format: 'jwk'});
  Object.assign(jwk, {kid: 'e2e-key', use: 'sig', alg: 'RS256'});
  const codes = new Map();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);

      if (url.pathname === '/.well-known/openid-configuration') {
        return json(res, 200, {
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks'
        });
      }

      if (url.pathname === '/jwks') return json(res, 200, {keys: [jwk]});

      if (url.pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        const challenge = url.searchParams.get('code_challenge');
        const clientId = url.searchParams.get('client_id');
        if (!redirectUri || !state || !challenge || clientId !== audience) return json(res, 400, {error: 'invalid_request'});
        const code = crypto.randomBytes(12).toString('base64url');
        codes.set(code, challenge);
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', state);
        res.writeHead(302, {location: callback.toString()});
        return res.end();
      }

      if (url.pathname === '/token' && req.method === 'POST') {
        const body = new URLSearchParams(await readBody(req));
        const code = body.get('code');
        const verifier = body.get('code_verifier');
        const expectedChallenge = codes.get(code);
        const actualChallenge = verifier
          ? crypto.createHash('sha256').update(verifier).digest('base64url')
          : null;
        if (!expectedChallenge || actualChallenge !== expectedChallenge || body.get('client_id') !== audience) {
          return json(res, 400, {error: 'invalid_grant'});
        }
        codes.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt(privateKey, {
          iss: issuer,
          aud: audience,
          sub: 'oidc-e2e-user',
          email: 'oidc@example.test',
          roles: ['admin'],
          iat: now,
          exp: now + 300
        });
        return json(res, 200, {
          token_type: 'Bearer',
          expires_in: 300,
          id_token: idToken,
          access_token: idToken
        });
      }

      return json(res, 404, {error: 'not_found'});
    } catch (error) {
      return json(res, 500, {error: error.message});
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    issuer,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

module.exports = {startFakeOidcProvider};
