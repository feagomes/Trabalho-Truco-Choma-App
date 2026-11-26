export type Team = 'A' | 'B';
export type Suit = 'CLUBS' | 'HEARTS' | 'SPADES' | 'DIAMONDS';
export type Card = { id: string; rank: string; suit: Suit };
export type Play = { playerId: string; card: Card };
export type Player = {
  id: string;
  nickname: string;
  seat: number;
  team: Team;
  cardsRemaining: number;
};

export type Action =
  | { type: 'START' | 'CALL_TRUCO' }
  | { type: 'PLAY_CARD'; cardId: string }
  | { type: 'RESPOND_TRUCO'; decision: 'ACCEPT' | 'FOLD' };

export type Room = {
  code: string;
  version: number;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
  players: Player[];
  me: { id: string; isHost: boolean; hand: Card[] };
  score: Record<Team, number>;
  winner: Team | null;
  hand: {
    number: number;
    vira: Card;
    turnPlayerId: string | null;
    value: number;
    table: Play[];
    pendingTruco: { callerId: string; responderId: string } | null;
  } | null;
  lastRound: { handNumber: number; plays: Play[]; winner: Team | null } | null;
  lastHand: { number: number; winner: Team | null; points: number } | null;
  allowedActions: Action['type'][];
};

export type Session = { code: string; token: string };
type RoomResponse = { room: Room };
type JoinResponse = { token: string; room: Room };

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const errors: Record<string, string> = {
  INVALID_INPUT: 'Confira os dados e tente novamente.',
  INVALID_SESSION: 'Sua sessão expirou. Crie ou entre em uma sala novamente.',
  ROOM_NOT_FOUND: 'Esta sala não está mais disponível. Confira o código.',
  ROOM_FULL: 'A sala já está cheia.',
  ROOM_ALREADY_STARTED: 'Essa partida já começou.',
  ACTION_FORBIDDEN: 'A ação não está disponível para você agora.',
  INVALID_ACTION: 'A mesa mudou. Confira as ações disponíveis.',
  STALE_VERSION: 'A mesa mudou. Confira o estado atualizado e escolha de novo.',
};

const ranks = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const suits = ['CLUBS', 'HEARTS', 'SPADES', 'DIAMONDS'];
const teams = ['A', 'B', null];

function isCard(card: Card) {
  return typeof card?.id === 'string' && ranks.includes(card.rank) && suits.includes(card.suit);
}

function isPlay(play: Play) {
  return typeof play?.playerId === 'string' && isCard(play.card);
}

function isPlayer(player: Player) {
  return typeof player?.id === 'string' && typeof player.nickname === 'string' &&
    Number.isInteger(player.seat) && player.seat >= 0 && player.seat < 4 &&
    (player.team === 'A' || player.team === 'B') &&
    Number.isInteger(player.cardsRemaining) && player.cardsRemaining >= 0;
}

function isHand(hand: NonNullable<Room['hand']>) {
  return Number.isSafeInteger(hand?.number) && isCard(hand.vira) &&
    (hand.turnPlayerId === null || typeof hand.turnPlayerId === 'string') &&
    (hand.value === 1 || hand.value === 3) &&
    Array.isArray(hand.table) && hand.table.every(isPlay) &&
    (hand.pendingTruco === null ||
      (typeof hand.pendingTruco?.callerId === 'string' && typeof hand.pendingTruco.responderId === 'string'));
}

function isRoom(room: Room) {
  if (
    typeof room?.code !== 'string' ||
    !Number.isSafeInteger(room.version) ||
    !['WAITING', 'PLAYING', 'FINISHED'].includes(room.status) ||
    !Array.isArray(room.players) || !room.players.every(isPlayer) ||
    typeof room.me?.id !== 'string' || typeof room.me.isHost !== 'boolean' ||
    !Array.isArray(room.me.hand) || !room.me.hand.every(isCard) ||
    !Number.isFinite(room.score?.A) || !Number.isFinite(room.score?.B) ||
    !teams.includes(room.winner) ||
    !Array.isArray(room.allowedActions) ||
    (room.hand === null ? room.status === 'PLAYING' : !isHand(room.hand))
  ) return false;

  const { lastRound, lastHand } = room;
  return (lastRound === null ||
    (Number.isSafeInteger(lastRound?.handNumber) && Array.isArray(lastRound.plays) &&
      lastRound.plays.every(isPlay) && teams.includes(lastRound.winner))) &&
    (lastHand === null || (Number.isSafeInteger(lastHand?.number) &&
      Number.isFinite(lastHand.points) && teams.includes(lastHand.winner)));
}

async function requestRoom(
  path: string,
  signal: AbortSignal,
  options: { token?: string; body?: object } = {},
): Promise<RoomResponse & { token?: string }> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.token) headers.set('Authorization', 'Bearer ' + options.token);
  if (options.body) headers.set('Content-Type', 'application/json');

  const response = await fetch('/api' + path, {
    method: options.body ? 'POST' : 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof data?.error?.code === 'string' ? data.error.code : '';
    if (Object.hasOwn(errors, code)) throw new ApiError(code, errors[code]);
    throw new ApiError('UNAVAILABLE', 'O servidor não respondeu como esperado. Tente novamente.');
  }

  const room = data?.room;
  if (!isRoom(room)) {
    throw new ApiError('UNAVAILABLE', 'A sala retornou dados inesperados. Tente novamente.');
  }
  return { room, token: data.token };
}

function roomPath(code: string) {
  return '/rooms/' + encodeURIComponent(code);
}

export async function enterRoom(nickname: string, code: string, signal: AbortSignal): Promise<JoinResponse> {
  const result = await requestRoom(code ? roomPath(code) + '/join' : '/rooms', signal, {
    body: { nickname },
  });
  if (typeof result.token !== 'string' || !result.token) {
    throw new ApiError('UNAVAILABLE', 'O servidor não devolveu a sessão da sala.');
  }
  return { room: result.room, token: result.token };
}

export async function getRoom(session: Session, signal: AbortSignal): Promise<Room> {
  const { room } = await requestRoom(roomPath(session.code), signal, { token: session.token });
  return room;
}

export async function sendAction(
  session: Session,
  action: Action,
  version: number,
  signal: AbortSignal,
): Promise<Room> {
  const { room } = await requestRoom(roomPath(session.code) + '/actions', signal, {
    token: session.token,
    body: { ...action, version },
  });
  return room;
}
