# Plano — Octopus Local Turbo

Quatro blocos independentes. Vou implementar todos, mas cada um funciona sozinho — se um serviço externo (Ollama/Playwright/Whisper) não estiver rodando, o app continua funcionando nos modos atuais.

## 1. Ollama — 3º modo "Local" (0 custo, offline)

- Novo modo ao lado de **Grátis** / **Pago**: **Local**.
- Detecção automática: ping em `http://localhost:11434/api/tags` ao abrir o app; se responder, mostra o modo Local no seletor com badge do modelo detectado (ex.: `llama3.1:8b`).
- Nova rota `src/routes/api/local-chat.ts` → proxy pra `http://localhost:11434/api/chat` (stream). Mesma persona "Octopus/Chefe".
- Seletor de modelo Local: lista o que o Ollama tem instalado.
- `src/lib/models.ts`: preço = 0 pra qualquer modelo `local/*`.
- Fallback: se Ollama sumir no meio da sessão, cai pro Grátis com aviso.

## 2. Playwright real (navegação de verdade no agente)

- Novo serviço opcional `scripts/playwright-bridge.mjs` — servidor Node standalone (porta 7676) que expõe:
  - `POST /navigate` `{url}` → abre página, retorna html+screenshot base64
  - `POST /click` `{url, selector}`
  - `POST /fill` `{url, selector, value}`
  - `POST /screenshot` `{url}` → PNG full-page
- Instalação: `npx playwright install chromium` (comando no README).
- Nova tool no agente: `browse_real(url, actions[])` — usa Playwright se `localhost:7676` responder; senão cai no `fetch` atual.
- Atualiza `src/routes/api/agent.ts` e `free-chat.ts` pra registrar a tool.
- UI: no `embedded-browser`, botão "🎭 abrir com Playwright" que injeta screenshot ao vivo.

## 3. Whisper local

- Novo serviço opcional `scripts/whisper-bridge.py` usando `faster-whisper` (modelo `base` = ~140MB, roda em CPU).
  - `POST /transcribe` (multipart audio) → `{text}`
  - Porta 7677.
- `src/routes/api/transcribe.ts` passa a tentar `localhost:7677` PRIMEIRO; se falhar, usa OpenAI Whisper.
- Modo Grátis + Whisper local = transcrição 100% offline e gratuita.
- README: `pip install faster-whisper flask` + `python scripts/whisper-bridge.py`.

## 4. PWA instalável (versão local vira "aplicativo")

- Adicionar `vite-plugin-pwa` com `generateSW` + `registerType: autoUpdate`.
- Wrapper de registro com guardas (não registra em preview Lovable, iframe, dev).
- `public/manifest.webmanifest`: nome "Octopus", tema laranja `#f97316`, `display: standalone`.
- Ícones 192/512/maskable em `public/icons/` (gerados agora).
- `NetworkFirst` pra HTML, `CacheFirst` pra assets hashed.
- Instalável no Chrome/Edge — ícone na área de trabalho, roda em janela própria.
- Modo offline: cache do shell; APIs continuam precisando de rede/serviços locais.

## Arquivos que vou tocar/criar

Criar:
- `src/routes/api/local-chat.ts`
- `src/routes/api/local-models.ts` (lista modelos Ollama)
- `scripts/playwright-bridge.mjs`
- `scripts/whisper-bridge.py`
- `public/manifest.webmanifest`
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable.png`
- `src/lib/pwa-register.ts`
- `src/lib/local-services.ts` (detecção Ollama/Playwright/Whisper)
- `README-LOCAL.md` (passo a passo dos 3 serviços)

Editar:
- `src/lib/models.ts` — preço 0 pros `local/*`
- `src/routes/api/transcribe.ts` — tenta Whisper local primeiro
- `src/routes/api/agent.ts`, `free-chat.ts` — nova tool `browse_real`
- `src/components/chat/new-chat-picker.tsx` / seletor de modo — 3º botão "Local"
- `src/components/chat/embedded-browser.tsx` — botão Playwright
- `src/routes/__root.tsx` — link manifest + theme-color
- `vite.config.ts` — plugin PWA
- `package.json` — deps

## Ordem de execução (na hora)

1. PWA (rápido, valor imediato — vira app)
2. Ollama (mais fácil de configurar pro chefe testar)
3. Whisper local (fallback automático)
4. Playwright bridge (mais pesado)

## Custo

R$ 0 em tudo. Ollama+Whisper+Playwright rodam localmente. PWA é só bundle.

Posso começar, chefe?
