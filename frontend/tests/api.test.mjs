import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enterRoom, getRoom, sendAction } from '../src/api.ts';

test('envia sessão e versão conforme o contrato e identifica conflito sem reenviar a jogada', async (context) => {
  const view = {
    code: 'MESA12', version: 8, status: 'WAITING', players: [],
    me: { id: 'jogador-1', isHost: true, hand: [] },
    score: { A: 0, B: 0 }, winner: null, hand: null, lastRound: null, lastHand: null,
    allowedActions: ['START'],
  };
  const signal = new AbortController().signal;
  const fetch = context.mock.method(globalThis, 'fetch', async (_url, request) => {
    if (request.body?.includes('"version":8')) {
      return Response.json({ error: { code: 'STALE_VERSION' } }, { status: 409 });
    }
    return Response.json({ room: view, token: 'sessao-1' });
  });

  const joined = await enterRoom('Bia', 'MESA12', signal);
  const session = { code: joined.room.code, token: joined.token };
  assert.equal((await getRoom(session, signal)).version, 8);
  await assert.rejects(sendAction(session, { type: 'START' }, 8, signal), { code: 'STALE_VERSION' });

  const [[joinUrl, join], [readUrl, read], [actionUrl, action]] = fetch.mock.calls.map((call) => call.arguments);
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(joinUrl, '/api/rooms/MESA12/join');
  assert.deepEqual(JSON.parse(join.body), { nickname: 'Bia' });
  assert.equal(readUrl, '/api/rooms/MESA12');
  assert.equal(read.headers.get('Authorization'), 'Bearer sessao-1');
  assert.equal(actionUrl, '/api/rooms/MESA12/actions');
  assert.equal(action.headers.get('Authorization'), 'Bearer sessao-1');
  assert.deepEqual(JSON.parse(action.body), { type: 'START', version: 8 });
});
