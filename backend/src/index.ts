import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';

type Suit = 'CLUBS' | 'HEARTS' | 'SPADES' | 'DIAMONDS';
type Rank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3';
type Team = 'A' | 'B';
type Card = { id: string; rank: Rank; suit: Suit };
type Player = { id: string; nickname: string; seat: number; team: Team; cards: Card[] };
type Play = { playerId: string; card: Card };
type Round = { handNumber: number; plays: Play[]; winner: Team | null };
type CompletedHand = { number: number; winner: Team | null; points: number };
type Hand = { number: number; vira: Card; turnPlayerId: string | null; value: number; table: Play[]; pendingTruco: { callerId: string; responderId: string } | null; openedBySeat: number; roundOpenerId: string; roundWinners: (Team | null)[]; trucoCalled: boolean };
type Room = { code: string; version: number; status: 'WAITING' | 'PLAYING' | 'FINISHED'; players: Player[]; hostId: string; score: Record<Team, number>; winner: Team | null; hand: Hand | null; lastRound: Round | null; lastHand: CompletedHand | null };
type Session = { roomCode: string; playerId: string };

const app = express();
export const game = {
  deck,
  strength,
  winnerOfRound(plays: Play[], vira: Card, teamFor: (playerId: string) => Team): Team | null {
    const max = Math.max(...plays.map(({ card }) => strength(card, vira)));
    const winners = new Set(plays.filter(({ card }) => strength(card, vira) === max).map(({ playerId }) => teamFor(playerId)));
    return winners.size === 1 ? [...winners][0] : null;
  },
  winnerOfHand(rounds: (Team | null)[]): Team | null {
    let result: Team | null | undefined;
    for (const team of ['A', 'B'] as Team[]) if (rounds.filter((winner) => winner === team).length >= 2) result = team;
    if (result !== undefined) return result;
    const [first, second, third] = rounds;
    if (first === null && second !== null) return second;
    if (second === null && first !== null) return first;
    if (first === null && second === null) return third ?? null;
    if (third === null) return first ?? null;
    return null;
  },
};
const rooms = new Map<string, Room>();
const sessions = new Map<string, Session>();
const suits: Suit[] = ['CLUBS', 'HEARTS', 'SPADES', 'DIAMONDS'];
const ranks: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const rankValue = new Map(ranks.map((rank, index) => [rank, index]));
const suitValue: Record<Suit, number> = { DIAMONDS: 0, SPADES: 1, HEARTS: 2, CLUBS: 3 };

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function token(): string { return randomBytes(32).toString('hex'); }
function roomCode(): string { return randomBytes(3).toString('hex').toUpperCase(); }
function teamAt(seat: number): Team { return seat % 2 === 0 ? 'A' : 'B'; }
function player(room: Room, id: string): Player { return room.players.find((p) => p.id === id)!; }
function sessionFor(request: Request, code: string): Session {
  const header = request.get('authorization');
  const value = header?.match(/^Bearer ([^\s]+)$/)?.[1];
  const session = value ? sessions.get(value) : undefined;
  if (!session || session.roomCode !== code) fail(401, 'INVALID_SESSION', 'Sessão inválida.');
  return session;
}
function view(room: Room, playerId?: string) {
  const me = playerId ? player(room, playerId) : undefined;
  const hand = room.hand ? { number: room.hand.number, vira: room.hand.vira, turnPlayerId: room.hand.turnPlayerId, value: room.hand.value, table: room.hand.table, pendingTruco: room.hand.pendingTruco } : null;
  const allowedActions: string[] = [];
  if (me && room.status === 'WAITING' && me.id === room.hostId && room.players.length === 4) allowedActions.push('START');
  if (me && room.status === 'PLAYING' && room.hand?.turnPlayerId === me.id && !room.hand.pendingTruco) {
    if (me.cards.length) allowedActions.push('PLAY_CARD');
    if (room.hand.value === 1 && !room.hand.trucoCalled) allowedActions.push('CALL_TRUCO');
  }
  if (me && room.hand?.pendingTruco?.responderId === me.id) allowedActions.push('RESPOND_TRUCO');
  return {
    code: room.code, version: room.version, status: room.status,
    players: room.players.map(({ id, nickname, seat, team, cards }) => ({ id, nickname, seat, team, cardsRemaining: cards.length })),
    me: me ? { id: me.id, isHost: me.id === room.hostId, hand: me.cards } : null,
    score: room.score, winner: room.winner, hand, lastRound: room.lastRound, lastHand: room.lastHand, allowedActions,
  };
}
function deck(): Card[] { return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}`, rank, suit }))); }
function startHand(room: Room, number: number, openerSeat: number) {
  const cards = deck();
  for (let i = cards.length - 1; i > 0; i--) { const j = randomBytes(4).readUInt32BE() % (i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  room.players.forEach((p) => { p.cards = []; });
  for (let n = 0; n < 3; n++) for (const p of room.players) p.cards.push(cards.shift()!);
  const vira = cards.shift()!;
  const opener = room.players[openerSeat];
  room.hand = { number, vira, turnPlayerId: opener.id, value: 1, table: [], pendingTruco: null, openedBySeat: openerSeat, roundOpenerId: opener.id, roundWinners: [], trucoCalled: false };
}
function strength(card: Card, vira: Card): number {
  const order = rankValue.get(vira.rank)!;
  const manilha = ranks[(order + 1) % ranks.length];
  return card.rank === manilha ? 10 + suitValue[card.suit] : rankValue.get(card.rank)!;
}
function finishHand(room: Room, winner: Team | null, points: number) {
  const hand = room.hand!;
  room.lastHand = { number: hand.number, winner, points };
  if (winner) room.score[winner] += points;
  const gameWinner = (['A', 'B'] as Team[]).find((team) => room.score[team] >= 12);
  if (gameWinner) { room.winner = gameWinner; room.status = 'FINISHED'; hand.turnPlayerId = null; return; }
  const nextOpener = (hand.openedBySeat + 1) % 4;
  startHand(room, hand.number + 1, nextOpener);
}
function finishRound(room: Room) {
  const hand = room.hand!;
  const maxStrength = Math.max(...hand.table.map((play) => strength(play.card, hand.vira)));
  const strongest = hand.table.filter((play) => strength(play.card, hand.vira) === maxStrength);
  const strongestTeams = new Set(strongest.map((play) => player(room, play.playerId).team));
  const winner = strongestTeams.size === 1 ? [...strongestTeams][0] : null;
  room.lastRound = { handNumber: hand.number, plays: [...hand.table], winner };
  hand.roundWinners.push(winner);
  let handWinner: Team | null | undefined;
  for (const team of ['A', 'B'] as Team[]) if (hand.roundWinners.filter((result) => result === team).length === 2) handWinner = team;
  if (handWinner !== undefined) { finishHand(room, handWinner, hand.value); return; }
  if (hand.roundWinners.length === 3) {
    const [first, second, third] = hand.roundWinners;
    handWinner = first === null && second !== null ? second : second === null && first !== null ? first : first === null && second === null ? third : third === null ? first : null;
    finishHand(room, handWinner, handWinner ? hand.value : 0);
    return;
  }
  if (winner) {
    const decisivePlay = strongest.find((play) => player(room, play.playerId).team === winner)!;
    hand.roundOpenerId = decisivePlay.playerId;
  } else {
    hand.roundOpenerId = hand.table[0].playerId;
  }
  hand.turnPlayerId = hand.roundOpenerId;
  hand.table = [];
}
function act(room: Room, playerId: string, input: Record<string, unknown>) {
  if (!Number.isSafeInteger(input.version) || input.version !== room.version) fail(409, 'STALE_VERSION', 'A versão da sala mudou.');
  if (room.status === 'FINISHED') fail(409, 'INVALID_ACTION', 'A partida terminou.');
  const p = player(room, playerId);
  if (input.type === 'START') {
    if (room.status !== 'WAITING' || playerId !== room.hostId) fail(403, 'ACTION_FORBIDDEN', 'Somente o anfitrião pode iniciar.');
    if (room.players.length !== 4) fail(403, 'ACTION_FORBIDDEN', 'A sala precisa estar completa.');
    room.status = 'PLAYING'; startHand(room, 1, 0); return;
  }
  if (room.status !== 'PLAYING' || !room.hand) fail(409, 'INVALID_ACTION', 'A partida ainda não começou.');
  const hand = room.hand;
  if (input.type === 'PLAY_CARD') {
    if (hand.pendingTruco || hand.turnPlayerId !== playerId) fail(403, 'ACTION_FORBIDDEN', 'Não é seu turno.');
    if (typeof input.cardId !== 'string') fail(400, 'INVALID_INPUT', 'cardId inválido.');
    const index = p.cards.findIndex((card) => card.id === input.cardId);
    if (index < 0) fail(409, 'INVALID_ACTION', 'A carta não está na sua mão.');
    const [card] = p.cards.splice(index, 1);
    hand.table.push({ playerId, card });
    hand.turnPlayerId = room.players[(p.seat + 1) % 4].id;
    if (hand.table.length === 4) finishRound(room);
    return;
  }
  if (input.type === 'CALL_TRUCO') {
    if (hand.pendingTruco || hand.turnPlayerId !== playerId || hand.trucoCalled) fail(403, 'ACTION_FORBIDDEN', 'Truco indisponível.');
    hand.trucoCalled = true;
    hand.pendingTruco = { callerId: playerId, responderId: room.players[(p.seat + 1) % 4].id };
    return;
  }
  if (input.type === 'RESPOND_TRUCO') {
    if (!hand.pendingTruco || hand.pendingTruco.responderId !== playerId) fail(403, 'ACTION_FORBIDDEN', 'Você não pode responder a este pedido.');
    if (input.decision === 'ACCEPT') { hand.value = 3; hand.turnPlayerId = hand.pendingTruco.callerId; hand.pendingTruco = null; return; }
    if (input.decision === 'FOLD') { const callerTeam = player(room, hand.pendingTruco.callerId).team; finishHand(room, callerTeam, 1); return; }
    fail(400, 'INVALID_INPUT', 'decision inválida.');
  }
  fail(400, 'INVALID_INPUT', 'Tipo de ação inválido.');
}

app.use(express.json());
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.post('/rooms', (request, response, next) => {
  try {
    const nickname = request.body?.nickname;
    if (typeof nickname !== 'string' || nickname.trim().length < 1 || nickname.trim().length > 20) fail(400, 'INVALID_INPUT', 'Apelido inválido.');
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const id = randomBytes(12).toString('hex');
    const room: Room = { code, version: 1, status: 'WAITING', players: [{ id, nickname: nickname.trim(), seat: 0, team: 'A', cards: [] }], hostId: id, score: { A: 0, B: 0 }, winner: null, hand: null, lastRound: null, lastHand: null };
    const access = token(); rooms.set(code, room); sessions.set(access, { roomCode: code, playerId: id });
    response.set('Cache-Control', 'no-store').status(201).json({ token: access, room: view(room, id) });
  } catch (error) { next(error); }
});
app.post('/rooms/:code/join', (request, response, next) => {
  try {
    const room = rooms.get(request.params.code.toUpperCase());
    if (!room) fail(404, 'ROOM_NOT_FOUND', 'Sala não encontrada.');
    if (room.status !== 'WAITING') fail(409, 'ROOM_ALREADY_STARTED', 'A partida já começou.');
    if (room.players.length >= 4) fail(409, 'ROOM_FULL', 'A sala está cheia.');
    const nickname = request.body?.nickname;
    if (typeof nickname !== 'string' || nickname.trim().length < 1 || nickname.trim().length > 20) fail(400, 'INVALID_INPUT', 'Apelido inválido.');
    const id = randomBytes(12).toString('hex'); const seat = room.players.length;
    room.players.push({ id, nickname: nickname.trim(), seat, team: teamAt(seat), cards: [] }); room.version++;
    const access = token(); sessions.set(access, { roomCode: room.code, playerId: id });
    response.set('Cache-Control', 'no-store').status(201).json({ token: access, room: view(room, id) });
  } catch (error) { next(error); }
});
app.get('/rooms/:code', (request, response, next) => {
  try { const code = request.params.code.toUpperCase(); const room = rooms.get(code); if (!room) fail(404, 'ROOM_NOT_FOUND', 'Sala não encontrada.'); const session = sessionFor(request, code); response.set('Cache-Control', 'no-store').json({ room: view(room, session.playerId) }); } catch (error) { next(error); }
});
app.post('/rooms/:code/actions', (request, response, next) => {
  try {
    const code = request.params.code.toUpperCase(); const room = rooms.get(code); if (!room) fail(404, 'ROOM_NOT_FOUND', 'Sala não encontrada.'); const session = sessionFor(request, code);
    act(room, session.playerId, request.body ?? {}); room.version++;
    response.set('Cache-Control', 'no-store').json({ room: view(room, session.playerId) });
  } catch (error) { next(error); }
});
const malformedJson: ErrorRequestHandler = (error, _request, _response, next) => {
  if (error instanceof SyntaxError && 'body' in error) next(new ApiError(400, 'INVALID_INPUT', 'JSON malformado.'));
  else next(error);
};
app.use(malformedJson);
app.use(((error: unknown, _request: Request, response: Response, _next: (error?: unknown) => void) => {
  const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'Erro interno.');
  response.set('Cache-Control', 'no-store').status(apiError.status).json({ error: { code: apiError.code, message: apiError.message } });
}) as ErrorRequestHandler);

if (process.env.NODE_ENV !== 'test') app.listen(3000, '127.0.0.1', () => console.log('API em http://localhost:3000'));
