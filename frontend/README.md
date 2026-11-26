# Front Web

Use Node.js 22.12 ou superior. Nesta pasta, execute:

```sh
npm ci
npm run dev
```

Abra http://localhost:5173. O Vite encaminha as requisições de /api para o Express em http://127.0.0.1:3000. Consulte o [contrato HTTP](../docs/api.md) para as rotas de salas e partidas.

Para testar com o Back em execução, abra quatro abas independentes, crie uma sala e entre nas demais com o código. Inicie a partida como anfitrião, jogue até uma dupla atingir 12 pontos e recarregue uma aba durante o jogo para verificar a sessão.

Execute npm test para conferir o contrato do cliente HTTP e npm run build para verificar TypeScript e gerar a build.
