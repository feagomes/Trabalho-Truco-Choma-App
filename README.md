# Trabalho Truco Choma

Base da aplicação web para uma partida de truco paulista adaptado em duplas. A [documentação do projeto](https://github.com/feagomes/Trabalho-Truco-Choma) contém regras, requisitos e diagramas. O [contrato HTTP](docs/api.md) orienta a integração.

## Estrutura

- **frontend/** — React, Vite e TypeScript.
- **backend/** — Express e TypeScript.
- **docs/** — Contrato da API e pasta de evidências da integração.

## Rodar a base

Use Node.js 22.12 ou superior e npm. Na raiz, execute:

```sh
npm --prefix frontend ci
npm --prefix backend ci
```

Em terminais separados:

```sh
npm --prefix frontend run dev
npm --prefix backend run dev
```

A página inicial abre em [localhost:5173](http://localhost:5173) e o endpoint de saúde responde em [localhost:3000/health](http://localhost:3000/health). A partida será implementada nas duas tarefas da sprint.

## TTC Sprint 1

| Tarefa | Responsável | Sequência sugerida de commits |
| --- | --- | --- |
| [TTC-1 · Front Web](https://fealgo.atlassian.net/browse/TTC-1) | Felipe Almeida Gomes | Lobby e navegação → mesa e ações → integração e evidências. |
| [TTC-2 · Back](https://fealgo.atlassian.net/browse/TTC-2) | Diego Suárez | Salas, sessões e API → regras da partida → integração e testes. |

Felipe pode montar as telas com dados locais seguindo o contrato enquanto Diego implementa a API. Para validar a entrega, abram quatro abas independentes, criem uma sala, joguem até 12 pontos e confiram o truco, a privacidade das cartas e a recuperação da tela ao recarregar.
