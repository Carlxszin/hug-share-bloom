# Plano — Octopus: aba indevida + leitura inteligente de páginas

## Problema 1 — Abre aba sozinho ao enviar qualquer mensagem
Hoje, todo prompt/início de chamada dispara `reserveExternalTab()` em `src/lib/browser-bus.ts`, que faz um `window.open("")` imediato (a "aba reservada Octopus"). Isso foi adicionado para driblar o bloqueio de popup quando o agente *de fato* precisa abrir um site, mas hoje executa **antes** de saber se há intenção de navegação.

### Correção planejada
1. Remover a chamada automática de `reserveExternalTab()` no submit do chat e no início da chamada em `src/routes/index.tsx`, `call-modal.tsx`, `free-call-modal.tsx`.
2. Reservar a aba **só sob gesto explícito**:
   - Quando o usuário clicar em um link/preview gerado pelo agente.
   - Quando o agente realmente chamar a tool `open_url` (lazy: tentar `openExternalTab` direto; se bloqueado, mostrar um botão "Abrir site" no chat que reserva no clique).
3. Detectar intenção de navegação no prompt antes de reservar (regex simples: "abrir", "tocar", "põe", "mostra", URL crua). Sem intenção = sem aba.

## Problema 2 — Na chamada o agente é "burro" com vídeos/páginas
Hoje, na chamada (Realtime e Free), as únicas tools são `web_search` (DDG) e `open_url`. Ele não lê o conteúdo da página, não enxerga campos, não sabe onde está cada coisa. Por isso parece desorientado quando peço um vídeo.

### Correção planejada — "Olho do Octopus"
1. **Nova aba dedicada de leitura** (`/reader?url=...`) que abre o site **dentro** de um iframe próprio em uma janela controlada pelo Octopus, com toolbar e painel lateral mostrando o que ele está extraindo. Permite ao usuário acompanhar visualmente.
2. **Novas tools no Realtime e Free-chat**:
   - `read_page(url)` — fetch server-side, extrai texto + headings + links + formulários (name/id/label/placeholder) e devolve JSON resumido.
   - `find_video(query)` — busca no YouTube (já temos `youtubeSearch`) + devolve top-3 com título, canal, duração e ID; modelo escolhe e chama `open_url` com `youtube.com/watch?v=ID`.
   - `inspect_fields(url)` — versão focada em formulários, lista cada campo com seletor/label, para ele saber "onde está cada coisa".
3. **Pipeline de contexto na call**: ao chamar `read_page`, devolver no `tool_output` um resumo curto (≤ 800 tokens) + lista de seções, e injetar mensagem de sistema do tipo "Você acabou de ler X. Resuma para o chefe em 1 frase antes de agir".
4. **Cache** desses reads usando o cache já existente do agente, para não pagar duas vezes a mesma página.
5. **UI da call**: no `SideFeed`, mostrar cards "🔎 leu página X" e "🎬 escolheu vídeo Y" para feedback visual em tempo real.

## Arquivos que serão tocados (na execução, não agora)
- `src/lib/browser-bus.ts` — remover auto-reserve.
- `src/routes/index.tsx`, `src/components/chat/composer.tsx` — não reservar aba no submit.
- `src/components/chat/call-modal.tsx`, `free-call-modal.tsx` — reservar só quando tool `open_url` for chamada.
- `src/routes/api/realtime-session.ts` — registrar tools `read_page`, `find_video`, `inspect_fields`.
- `src/routes/api/free-chat.ts` — idem para o modo grátis.
- `src/routes/api/read-page.ts` *(novo)* — fetch + extração HTML → JSON.
- `src/routes/api/find-video.ts` *(novo)* — wrapper YouTube.
- `src/components/chat/side-feed.tsx` — novos cards de tool.

## Custo extra esperado
Zero no modo Free (tudo via fetch + scraping). No Realtime, ~+150 tokens por `read_page` (resumo enxuto), ainda dentro do teto de 200 tokens já configurado.

Quer que eu prossiga com a implementação, chefe?
