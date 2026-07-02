import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../server.js';

test('does not expose Express fingerprint header', async () => {
  const response = await request(app).get('/health').expect(200);

  assert.equal(response.headers['x-powered-by'], undefined);
});

test('rejects untrusted CORS origins', async () => {
  const response = await request(app).get('/health').set('Origin', 'https://evil.example').expect(403);

  assert.equal(response.body.error, 'Origin is not allowed.');
});

test('rejects malformed report ids before lookup', async () => {
  const response = await request(app).get('/api/reports/bad%2Cid').expect(400);

  assert.equal(response.body.error, 'Invalid report id.');
});
