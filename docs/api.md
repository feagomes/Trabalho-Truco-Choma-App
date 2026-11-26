# Contrato HTTP da primeira versão

Contrato proposto para TTC-1 e TTC-2. As rotas de sala serão implementadas na sprint. A base já expõe GET /health.

## Rotas

A API local usa http://localhost:3000. No navegador, use o prefixo /api. Em desenvolvimento, o Vite remove o prefixo e encaminha para o Express. Por exemplo, /api/health chega à API como /health. Os corpos e respostas são JSON.

| Método e rota | Corpo | Sucesso |
| --- | --- | --- |
| POST /rooms | { nickname } | 201 com { token, room }. Cria a sala e a sessão do anfitrião. |
| POST /rooms/:code/join | { nickname } | 201 com { token, room }. Ocupa a primeira vaga livre. |
| GET /rooms/:code | — | 200 com { room }. |
| POST /rooms/:code/actions | { type, version, ...campos } | 200 com { room }. Aplica a ação e retorna a nova visão. |

GET da sala e POST de ações exigem o cabeçalho `Authorization: Bearer <token>`. O navegador guarda código e token em sessionStorage para recuperar a mesma aba. Cada resposta da sala leva Cache-Control: no-store.

## Ações

- **START** — inicia a partida. Somente o anfitrião com quatro vagas ocupadas.
- **PLAY_CARD** — leva também cardId, da mão do jogador do turno.
- **CALL_TRUCO** — abre o pedido no turno de quem chamou.
- **RESPOND_TRUCO** — leva decision, com ACCEPT ou FOLD. Somente o adversário indicado responde.

Toda ação leva a versão inteira exibida pelo cliente. O servidor incrementa a versão após uma entrada ou ação aceita. Se duas ações competirem pela mesma versão, a segunda recebe um conflito e a interface atualiza o estado. O cliente não reenvia a jogada automaticamente.

## Visão da sala

| Campo | Formato |
| --- | --- |
| code, version, status | Código de convite, inteiro monotônico e WAITING, PLAYING ou FINISHED. |
| players | Lista de { id, nickname, seat, team, cardsRemaining }. team é A ou B. |
| me | { id, isHost, hand }. Cada carta tem { id, rank, suit }. |
| score, winner | { A, B } e a dupla vencedora, ou null. |
| hand | null no lobby ou { number, vira, turnPlayerId, value, table, pendingTruco }. table é a lista de { playerId, card } da rodada em curso. turnPlayerId é null após a partida. |
| hand.pendingTruco | null ou { callerId, responderId }, com a jogada pausada enquanto o pedido estiver aberto. |
| lastRound | null ou { handNumber, plays, winner }. Guarda a última rodada concluída, inclusive na troca de mão. winner é null em empate. |
| lastHand | null ou { number, winner, points }. Guarda o último resultado de mão, inclusive recusa ou empate. |
| allowedActions | Lista de tipos de ações disponíveis para essa sessão. |

rank usa 4, 5, 6, 7, Q, J, K, A, 2 ou 3 como texto. suit usa CLUBS, HEARTS, SPADES ou DIAMONDS. A mão privada de outros participantes e as cartas do baralho permanecem no servidor. Uma aba descarta respostas de consulta com versão inferior à já exibida.

## Erros

Formato { error: { code, message } }.

- **400 INVALID_INPUT** — corpo, versão, carta ou apelido com formato inválido.
- **401 INVALID_SESSION** — sessão ausente, inválida ou vinculada a outra sala.
- **403 ACTION_FORBIDDEN** — jogador sem permissão para a ação naquele estado.
- **404 ROOM_NOT_FOUND** — sala indisponível.
- **409 ROOM_FULL, ROOM_ALREADY_STARTED, STALE_VERSION ou INVALID_ACTION** — conflito com o estado atual, incluindo carta já jogada.

A primeira versão usa uma instância do servidor e salas em memória.
