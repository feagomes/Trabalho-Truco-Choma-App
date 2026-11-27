import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const api = 'http://127.0.0.1:3000';
type Result = { status: number; data: any; headers: Headers };
async function request(path: string, method = 'GET', body?: unknown, token?: string): Promise<Result> {
  const response = await fetch(`${api}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function createGame() {
  const created = await request('/rooms', 'POST', { nickname: 'host' });
  const code = created.data.room.code;
  const players = [{ token: created.data.token, id: created.data.room.me.id }];
  for (const nickname of ['p1', 'p2', 'p3']) {
    const joined = await request(`/rooms/${code}/join`, 'POST', { nickname });
    players.push({ token: joined.data.token, id: joined.data.room.me.id });
  }
  let room = (await request(`/rooms/${code}`, 'GET', undefined, players[0].token)).data.room;
  room = (await request(`/rooms/${code}/actions`, 'POST', { type: 'START', version: room.version }, players[0].token)).data.room;
  return { code, players, room };
}
async function state(code: string, token: string) { return (await request(`/rooms/${code}`, 'GET', undefined, token)).data.room; }
async function play(code: string, players: {token: string; id: string}[], room: any, seat: number, cardIndex = 0) {
  const player = players.find((p) => p.id === room.hand.turnPlayerId)!;
  const own = await state(code, player.token);
  const res = await request(`/rooms/${code}/actions`, 'POST', { type: 'PLAY_CARD', cardId: own.me.hand[cardIndex].id, version: room.version }, player.token);
  assert.equal(res.status, 200);
  return res.data.room;
}

describe('Truco Choma backend HTTP', () => {
  it('distributes 12 unique cards and keeps other hands private', async () => {
    const { code, players, room } = await createGame();
    const cards: string[] = [];
    for (const session of players) {
      const response = await request(`/rooms/${code}`, 'GET', undefined, session.token);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      cards.push(...response.data.room.me.hand.map((card: {id: string}) => card.id));
      for (const p of response.data.room.players) assert.ok(!('hand' in p));
    }
    assert.equal(cards.length, 12);
    assert.equal(new Set(cards).size, 12);
    assert.equal(room.players.length, 4);
  });

  it('validates sessions, full rooms, permissions, turn, card ownership, malformed JSON, and stale races', async () => {
    const created = await request('/rooms', 'POST', { nickname: 'host' });
    const code = created.data.room.code;
    const host = created.data.token;
    const p1 = (await request(`/rooms/${code}/join`, 'POST', { nickname: 'p1' })).data.token;
    const p2 = (await request(`/rooms/${code}/join`, 'POST', { nickname: 'p2' })).data.token;
    let room = await state(code, host);
    const early = await request(`/rooms/${code}/actions`, 'POST', { type: 'START', version: room.version }, host);
    assert.equal(early.status, 403);
    const fourth = await request(`/rooms/${code}/join`, 'POST', { nickname: 'p3' });
    const p3 = fourth.data.token;
    room = await state(code, host);
    const strangerStart = await request(`/rooms/${code}/actions`, 'POST', { type: 'START', version: room.version }, p1);
    assert.equal(strangerStart.status, 403);
    const started = await request(`/rooms/${code}/actions`, 'POST', { type: 'START', version: room.version }, host);
    room = started.data.room;
    assert.equal((await request(`/rooms/${code}/join`, 'POST', { nickname: 'late' })).status, 409);
    assert.equal((await request(`/rooms/${code}`, 'GET', undefined, (await request('/rooms', 'POST', { nickname: 'other' })).data.token)).status, 401);
    const wrongTurn = playersToken(room.players[1].id, [host, p1, p2, p3], room);
    const notYourTurn = await request(`/rooms/${code}/actions`, 'POST', { type: 'PLAY_CARD', cardId: 'fake', version: room.version }, wrongTurn.token);
    assert.equal(notYourTurn.status, 403);
    const turn = playersToken(room.hand.turnPlayerId, [host, p1, p2, p3], room);
    assert.equal((await request(`/rooms/${code}/actions`, 'POST', { type: 'PLAY_CARD', cardId: 'fake', version: room.version }, turn.token)).status, 409);
    const racePayload = { type: 'PLAY_CARD', cardId: (await state(code, turn.token)).me.hand[0].id, version: room.version };
    const race = await Promise.all([request(`/rooms/${code}/actions`, 'POST', racePayload, turn.token), request(`/rooms/${code}/actions`, 'POST', racePayload, turn.token)]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const malformed = await fetch(`${api}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
  });

  it('accepts truco, pauses play, and grants caller the next turn', async () => {
    const { code, players, room } = await createGame();
    const caller = players.find((p) => p.id === room.hand.turnPlayerId)!;
    const asked = await request(`/rooms/${code}/actions`, 'POST', { type: 'CALL_TRUCO', version: room.version }, caller.token);
    assert.equal(asked.status, 200);
    const pending = asked.data.room;
    assert.deepEqual(pending.hand.pendingTruco, { callerId: caller.id, responderId: players[1].id });
    const blocked = await request(`/rooms/${code}/actions`, 'POST', { type: 'PLAY_CARD', cardId: 'fake', version: pending.version }, caller.token);
    assert.equal(blocked.status, 403);
    const accepted = await request(`/rooms/${code}/actions`, 'POST', { type: 'RESPOND_TRUCO', decision: 'ACCEPT', version: pending.version }, players[1].token);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.room.hand.value, 3);
    assert.equal(accepted.data.room.hand.turnPlayerId, caller.id);
    assert.ok(!accepted.data.room.allowedActions.includes('CALL_TRUCO'));
  });

  it('awards one point on fold and rotates to a new hand while retaining results', async () => {
    const { code, players, room } = await createGame();
    const caller = players.find((p) => p.id === room.hand.turnPlayerId)!;
    const asked = await request(`/rooms/${code}/actions`, 'POST', { type: 'CALL_TRUCO', version: room.version }, caller.token);
    const pending = asked.data.room;
    const responder = players.find((p) => p.id === pending.hand.pendingTruco.responderId)!;
    const folded = await request(`/rooms/${code}/actions`, 'POST', { type: 'RESPOND_TRUCO', decision: 'FOLD', version: pending.version }, responder.token);
    assert.equal(folded.data.room.score[caller.id === players[0].id || caller.id === players[2].id ? 'A' : 'B'], 1);
    assert.equal(folded.data.room.hand.number, 2);
    assert.equal(folded.data.room.lastHand.points, 1);
    assert.equal(folded.data.room.hand.turnPlayerId, players[1].id);
  });

  it('folds truco for the challenger team, reaches 12 points, and rejects later actions', async () => {
    const { code, players, room: started } = await createGame();
    let room = started;
    while (room.score.A < 11) {
      const caller = players.find((p) => p.id === room.hand.turnPlayerId)!;
      const team = room.players.find((p: any) => p.id === caller.id).team;
      if (team !== 'A') {
        room = await play(code, players, room);
        continue;
      }
      const requested = await request(`/rooms/${code}/actions`, 'POST', { type: 'CALL_TRUCO', version: room.version }, caller.token);
      assert.equal(requested.status, 200);
      room = requested.data.room;
      const responder = players.find((p) => p.id === room.hand.pendingTruco.responderId)!;
      const folded = await request(`/rooms/${code}/actions`, 'POST', { type: 'RESPOND_TRUCO', decision: 'FOLD', version: room.version }, responder.token);
      room = folded.data.room;
    }
    const caller = players.find((p) => p.id === room.hand.turnPlayerId)!;
    if (room.players.find((p: any) => p.id === caller.id).team !== 'A') {
      while (room.players.find((p: any) => p.id === room.hand.turnPlayerId).team !== 'A') room = await play(code, players, room);
    }
    const finalCaller = players.find((p) => p.id === room.hand.turnPlayerId)!;
    room = (await request(`/rooms/${code}/actions`, 'POST', { type: 'CALL_TRUCO', version: room.version }, finalCaller.token)).data.room;
    const responder = players.find((p) => p.id === room.hand.pendingTruco.responderId)!;
    const finished = await request(`/rooms/${code}/actions`, 'POST', { type: 'RESPOND_TRUCO', decision: 'FOLD', version: room.version }, responder.token);
    assert.equal(finished.data.room.status, 'FINISHED');
    assert.equal(finished.data.room.winner, 'A');
    assert.ok(finished.data.room.score.A >= 12);
    assert.equal(finished.data.room.hand.turnPlayerId, null);
    assert.equal((await request(`/rooms/${code}/actions`, 'POST', { type: 'CALL_TRUCO', version: finished.data.room.version }, finalCaller.token)).status, 409);
  });

  it('plays a hand to completion, preserves last round, and rotates opener', async () => {
    const { code, players, room: started } = await createGame();
    let room = started;
    while (room.hand.number === 1) room = await play(code, players, room, 0);
    assert.equal(room.hand.number, 2);
    assert.ok(room.lastRound);
    assert.equal(room.lastRound.handNumber, 1);
    assert.equal(room.hand.turnPlayerId, players[1].id);
  });
});

function playersToken(playerId: string, tokens: string[], room: any) {
  const seat = room.players.find((p: any) => p.id === playerId).seat;
  return { token: tokens[seat], id: playerId };
}
