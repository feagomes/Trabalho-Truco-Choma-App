import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { game } from './index.js';

const suits = ['CLUBS', 'HEARTS', 'SPADES', 'DIAMONDS'] as const;
const ranks = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const;
const card = (rank: typeof ranks[number], suit: typeof suits[number]) => ({ id: `${rank}-${suit}`, rank, suit });

describe('deterministic game rules', () => {
  it('builds 40 distinct cards', () => {
    const deck = game.deck();
    assert.equal(deck.length, 40);
    assert.equal(new Set(deck.map((item) => item.id)).size, 40);
  });

  it('ranks manilhas by suit and wraps vira 3 to manilha 4', () => {
    const vira = card('3', 'DIAMONDS');
    assert.ok(game.strength(card('4', 'CLUBS'), vira) > game.strength(card('4', 'HEARTS'), vira));
    assert.ok(game.strength(card('4', 'HEARTS'), vira) > game.strength(card('4', 'SPADES'), vira));
    assert.ok(game.strength(card('4', 'SPADES'), vira) > game.strength(card('4', 'DIAMONDS'), vira));
    assert.ok(game.strength(card('4', vira.suit === 'DIAMONDS' ? 'CLUBS' : 'DIAMONDS'), vira) > game.strength(card('3', 'CLUBS'), vira));
  });

  it('resolves round ties between teams as a draw', () => {
    const vira = card('5', 'DIAMONDS');
    const plays = [
      { playerId: 'a0', card: card('7', 'CLUBS') },
      { playerId: 'b1', card: card('7', 'HEARTS') },
      { playerId: 'a2', card: card('4', 'CLUBS') },
      { playerId: 'b3', card: card('4', 'HEARTS') },
    ];
    assert.equal(game.winnerOfRound(plays, vira, (id) => id.startsWith('a') ? 'A' : 'B'), null);
  });

  it('resolves tied and mixed round sequences according to hand rules', () => {
    assert.equal(game.winnerOfHand([null, 'B']), 'B');
    assert.equal(game.winnerOfHand(['A', 'B', null]), 'A');
    assert.equal(game.winnerOfHand([null, null, 'B']), 'B');
    assert.equal(game.winnerOfHand([null, null, null]), null);
    assert.equal(game.winnerOfHand(['A', 'B', 'B']), 'B');
  });
});
