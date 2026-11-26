import { useRef, useState } from 'react';
import type { Action, Card, Player, Room, Suit } from './api';

const suits: Record<Suit, { symbol: string; label: string }> = {
  CLUBS: { symbol: '♣', label: 'paus' },
  HEARTS: { symbol: '♥', label: 'copas' },
  SPADES: { symbol: '♠', label: 'espadas' },
  DIAMONDS: { symbol: '♦', label: 'ouros' },
};

function cardName(card: Card) {
  const rank = { A: 'Ás', J: 'Valete', Q: 'Dama', K: 'Rei' }[card.rank] ?? card.rank;
  return rank + ' de ' + suits[card.suit].label;
}

function CardFace({ card }: { card: Card }) {
  const suit = suits[card.suit];
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';

  return (
    <span className={'card-face' + (red ? ' card-red' : '')} role="img" aria-label={cardName(card)}>
      <span className="card-corner" aria-hidden="true">{card.rank}<small>{suit.symbol}</small></span>
      <span className="card-suit" aria-hidden="true">{suit.symbol}</span>
    </span>
  );
}

type Controls = {
  room: Room;
  pending: boolean;
  act: (action: Action) => void;
};

function PlayerName({ player, me }: { player: Player; me: string }) {
  return <span className="name-wrap">
    <span className="player-name" title={player.nickname}>{player.nickname}</span>
    {player.id === me && <span className="you">Você</span>}
  </span>;
}

function Score({ room }: { room: Room }) {
  return (
    <div className="score" aria-label="Placar">
      {(['A', 'B'] as const).map((team) => (
        <div key={team} className={'score-side team-' + team}>
          <span>Dupla {team}</span>
          <strong>{room.score[team]}</strong>
        </div>
      ))}
    </div>
  );
}

export function Lobby({ room, pending, act }: Controls) {
  const [copyStatus, setCopyStatus] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopyStatus('Código copiado.');
    } catch {
      codeInput.current?.focus();
      codeInput.current?.select();
      setCopyStatus('Código selecionado para copiar.');
    }
  }

  return (
    <section className="lobby">
      <div className="section-heading">
        <h1 id="screen-title" tabIndex={-1}>Sala de espera</h1>
        <p role="status">{room.players.length} de 4 vagas ocupadas</p>
      </div>

      <div className="lobby-content">
        <div className="invite">
          <label htmlFor="invite-code">Código da sala</label>
          <div className="invite-controls">
            <input id="invite-code" ref={codeInput} value={room.code} readOnly onFocus={(event) => event.target.select()} />
            <button className="button button-outline" onClick={copyCode}>Copiar código</button>
          </div>
          <p>Compartilhe com os outros jogadores.</p>
          <span className="copy-status" role="status">{copyStatus}</span>
        </div>

        <div className="teams">
          {(['A', 'B'] as const).map((team, position) => (
            <section className={'team-box team-' + team} key={team}>
              <h2>Dupla {team}</h2>
              <ul>
                {[position, position + 2].map((seat) => {
                  const player = room.players.find((person) => person.seat === seat);
                  return (
                    <li key={seat} className={player ? 'occupied' : 'vacant'}>
                      <span className="avatar" aria-hidden="true">{player ? [...player.nickname][0]?.toUpperCase() : '·'}</span>
                      {player ? (
                        <div className="roster-name">
                          <PlayerName player={player} me={room.me.id} />
                          {seat === 0 && <small>Anfitrião</small>}
                        </div>
                      ) : <span>Vaga livre</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <div className="lobby-footer">
        <p>{room.players.length === 4
          ? room.me.isHost ? 'Mesa completa. Você já pode iniciar.' : 'Mesa completa. Aguardando o anfitrião.'
          : 'A partida começa quando as quatro vagas estiverem ocupadas.'}</p>
        {room.me.isHost && (
          <button className="button button-primary" disabled={pending || !room.allowedActions.includes('START')}
            onClick={() => act({ type: 'START' })}>
            {pending ? 'Iniciando…' : 'Iniciar partida'}
          </button>
        )}
      </div>
    </section>
  );
}

function Seat({ player, self, active, position }: { player?: Player; self: string; active: boolean; position: string }) {
  if (!player) return null;

  return (
    <div className={'seat seat-' + position + ' team-' + player.team + (active ? ' seat-active' : '')}>
      <PlayerName player={player} me={self} />
      <span className="seat-meta">Dupla {player.team} · {player.cardsRemaining} {player.cardsRemaining === 1 ? 'carta' : 'cartas'}</span>
    </div>
  );
}

function LastResults({ room }: { room: Room }) {
  const round = room.lastRound;
  const hand = room.lastHand;
  if (!round && !hand) return null;

  return (
    <aside className="results" aria-label="Resultados recentes">
      {hand && <p className="hand-result">Mão {hand.number} · {hand.winner
        ? 'Dupla ' + hand.winner + ' marcou ' + hand.points + (hand.points === 1 ? ' ponto' : ' pontos')
        : 'Empate sem pontos'}</p>}
      {round && (
        <details>
          <summary>Última rodada · {round.winner ? 'Dupla ' + round.winner : 'Empate'}</summary>
          <ul className="round-plays">
            {round.plays.map(({ playerId, card }) => (
              <li key={playerId}>
                <span>{room.players.find((person) => person.id === playerId)?.nickname ?? 'Jogador'}</span>
                <span>{cardName(card)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

export function Table({ room, pending, act }: Controls) {
  const hand = room.hand;
  if (!hand) return null;

  const me = room.players.find((player) => player.id === room.me.id);
  const mySeat = me?.seat ?? 0;
  const truco = hand.pendingTruco;
  const turn = room.players.find((player) => player.id === hand.turnPlayerId);
  const caller = room.players.find((player) => player.id === truco?.callerId);
  const responder = room.players.find((player) => player.id === truco?.responderId);
  const allowed = (type: Action['type']) => !pending && room.allowedActions.includes(type);
  const canPlay = !truco && allowed('PLAY_CARD');
  let turnLabel = turn?.id === room.me.id ? 'Sua vez de jogar' : turn ? 'Vez de ' + turn.nickname : 'Aguardando a jogada';
  if (truco) turnLabel = truco.responderId === room.me.id ? 'Responda ao pedido de truco' : 'Aguardando a resposta ao truco';

  return (
    <section className="game">
      <div className="game-header">
        <div>
          <h1 id="screen-title" tabIndex={-1}>Mesa de jogo</h1>
          <p>Mão {hand.number} · Vale {hand.value} {hand.value === 1 ? 'ponto' : 'pontos'}</p>
        </div>
        <Score room={room} />
      </div>

      <div className="felt">
        {(['left', 'top', 'right'] as const).map((position, index) => {
          const seat = (mySeat + [3, 2, 1][index]) % 4;
          const player = room.players.find((person) => person.seat === seat);
          return <Seat key={position} player={player} self={room.me.id} position={position}
            active={!!player && (truco ? player.id === truco.responderId : player.id === hand.turnPlayerId)} />;
        })}
        <div className="table-center">
          <div className="vira">
            <h2>Vira</h2>
            <CardFace card={hand.vira} />
          </div>
          <section className="played">
            <h2>Cartas na mesa</h2>
            {hand.table.length ? (
              <ul className="table-cards">
                {hand.table.map(({ playerId, card }) => (
                  <li key={playerId}>
                    <CardFace card={card} />
                    <span>{room.players.find((person) => person.id === playerId)?.nickname ?? 'Jogador'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-table">Aguardando a primeira carta</p>}
          </section>
        </div>
        <div className="turn" role="status">{turnLabel}</div>
      </div>

      {truco && (
        <section className="truco-call" aria-label="Pedido de truco">
          <div>
            <h2>{caller?.nickname ?? 'Um jogador'} pediu truco!</h2>
            <p>{truco.responderId === room.me.id
              ? 'Aceitar vale 3 pontos. Correr concede 1 ponto à dupla adversária.'
              : 'Aguardando ' + (responder?.nickname ?? 'a dupla adversária') + ' responder.'}</p>
          </div>
          {truco.responderId === room.me.id && room.allowedActions.includes('RESPOND_TRUCO') && (
            <div className="action-row">
              <button className="button button-primary" disabled={pending}
                onClick={() => act({ type: 'RESPOND_TRUCO', decision: 'ACCEPT' })}>Aceitar</button>
              <button className="button button-outline" disabled={pending}
                onClick={() => act({ type: 'RESPOND_TRUCO', decision: 'FOLD' })}>Correr</button>
            </div>
          )}
        </section>
      )}

      <section className="my-hand">
        <div className="hand-heading">
          <div>
            <h2>Suas cartas</h2>
            {me && <p className={'hand-team team-' + me.team}>Dupla {me.team}</p>}
          </div>
          {room.allowedActions.includes('CALL_TRUCO') && !truco && (
            <button className="button button-primary" disabled={!allowed('CALL_TRUCO')}
              onClick={() => act({ type: 'CALL_TRUCO' })}>Pedir truco</button>
          )}
        </div>
        {room.me.hand.length ? (
          <ul className="hand-cards">
            {room.me.hand.map((card) => (
              <li key={card.id}>
                <button className="play-card" disabled={!canPlay} aria-label={'Jogar ' + cardName(card)}
                  onClick={() => act({ type: 'PLAY_CARD', cardId: card.id })}>
                  <CardFace card={card} />
                </button>
              </li>
            ))}
          </ul>
        ) : <p>Você já jogou todas as cartas desta mão.</p>}
      </section>
      <LastResults room={room} />
    </section>
  );
}

export function FinalScore({ room, onBack }: { room: Room; onBack: () => void }) {
  return (
    <section className="finished">
      <span className="finish-suit" aria-hidden="true">♣</span>
      <h1 id="screen-title" tabIndex={-1}>
        {room.winner ? 'Dupla ' + room.winner + ' venceu!' : 'Partida encerrada'}
      </h1>
      <Score room={room} />
      <LastResults room={room} />
      <button className="button button-primary" onClick={onBack}>Voltar à entrada</button>
    </section>
  );
}
