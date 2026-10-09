'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const jose = require(path.join(process.cwd(), 'node_modules', 'jose'));

const issuer = 'http://127.0.0.1:3502';
const app = 'http://127.0.0.1:3503';
const respond = (res, status, body) => {
  res.writeHead(status, {'content-type':'application/json'});
  res.end(JSON.stringify(body));
};

(async () => {
  const {publicKey, privateKey} = await jose.generateKeyPair('RS256');
  const jwk = {...await jose.exportJWK(publicKey), kid:'ci-oidc-key', use:'sig', alg:'RS256'};
  let challenge;
  let exchanges = 0;
  let signedToken;
  const provider = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration') return respond(res, 200, {
      issuer, authorization_endpoint:issuer + '/authorize', token_endpoint:issuer + '/token', jwks_uri:issuer + '/jwks'
    });
    if (url.pathname === '/jwks') return respond(res, 200, {keys:[jwk]});
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const computed = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (form.get('code') !== 'ci-code' || computed !== challenge ||
        form.get('redirect_uri') !== app + '/auth/oidc/callback' ||
        form.get('client_id') !== 'ci-oidc-client') return respond(res, 400, {error:'invalid_grant'});
      exchanges += 1;
      const token = await new jose.SignJWT({sub:'ci-oidc-user',email:'oidc@example.com',roles:['member']})
        .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer)
        .setAudience('ci-oidc-client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
      signedToken = token;
      return respond(res, 200, {access_token:token,id_token:token,token_type:'Bearer',expires_in:300});
    }
    return respond(res, 404, {error:'not_found'});
  });
  await new Promise(resolve => provider.listen(3502, '127.0.0.1', resolve));
  try {
    const login = await fetch(app + '/auth/oidc/login', {redirect:'manual'});
    assert.equal(login.status,302);
    const destination = new URL(login.headers.get('location'));
    assert.equal(destination.origin,issuer);
    assert.equal(destination.pathname,'/authorize');
    assert.equal(destination.searchParams.get('code_challenge_method'),'S256');
    const state=destination.searchParams.get('state');
    challenge=destination.searchParams.get('code_challenge');
    assert.ok(state && challenge);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('j2e_oidc_state='));

    const callback = app + '/auth/oidc/callback?code=ci-code&state=' + encodeURIComponent(state);
    const missingCookie=await fetch(callback);
    assert.equal(missingCookie.status,401,'state cookie is required');
    const wrongState=await fetch(app + '/auth/oidc/callback?code=ci-code&state=wrong',{headers:{cookie}});
    assert.equal(wrongState.status,401,'state must match cookie');
    const success=await fetch(callback,{headers:{cookie}});
    assert.equal(success.status,200);
    const credentials=await success.json();
    assert.ok(credentials.accessToken, 'OIDC must issue credentials');
    assert.equal(exchanges,1, 'only one successful provider exchange');
    const replay=await fetch(callback,{headers:{cookie}});
    assert.equal(replay.status,401,'OIDC state cannot be replayed');
    assert.equal(exchanges,1);
    const validBearer = await fetch(app+'/api/todos',{headers:{authorization:'Bearer '+signedToken}});
    assert.equal(validBearer.status,200,'valid provider-issued JWT must authorize native CRUD');
    const malformedBearer=await fetch(app+'/api/todos',{headers:{authorization:'Bearer not-a-jwt'}});
    assert.equal(malformedBearer.status,401);
    console.log('OIDC provider exchange, PKCE verification, token validation and state replay checks passed');
  } finally {
    await new Promise(resolve => provider.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
