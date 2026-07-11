# Octopus — Modo Local Turbo

Guia dos 3 serviços opcionais que rodam **na sua máquina** e turbinam o Octopus:
Ollama (LLM), Whisper local (transcrição) e Playwright (navegação real). Nenhum
é obrigatório — o Octopus continua funcionando sem eles.

---

## 1. Ollama (LLM local, 0 custo, offline)

1. Baixe: <https://ollama.com/download>
2. Instale e rode:
   ```bash
   ollama serve
   ```
3. Em outro terminal, baixe um modelo (recomendado):
   ```bash
   ollama pull llama3.1:8b
   # ou menor:
   ollama pull qwen2.5:3b
   ```
4. Abra o Octopus. Ele detecta automaticamente `localhost:11434` e libera o modo **Local**.

Endpoints usados pelo app:
- `POST /api/local-chat` → proxy stream pro Ollama
- `GET /api/local-models` → lista o que você tem instalado

---

## 2. Whisper local (transcrição offline)

Usa `faster-whisper` (leve, roda em CPU).

```bash
pip install faster-whisper flask
python scripts/whisper-bridge.py
```

O Octopus tenta `http://localhost:7677` **antes** da OpenAI. Se estiver rodando,
transcrição é grátis. Se cair, cai automático pro Whisper da OpenAI.

Variáveis opcionais:
- `OCTOPUS_WHISPER_MODEL` (padrão `base`; opções: `tiny`, `small`, `medium`)
- `OCTOPUS_WHISPER_COMPUTE` (padrão `int8`)

---

## 3. Playwright (navegação real, cliques, screenshots)

```bash
npx playwright install chromium
node scripts/playwright-bridge.mjs
```

Sobe em `http://localhost:7676`. Endpoints:
- `POST /navigate {url}` → título + texto + screenshot base64
- `POST /screenshot {url,fullPage?}` → PNG base64
- `POST /click {url,selector}`
- `POST /fill {url,selector,value}`

Quando o bridge está no ar, o agente ganha visão real (SPA, JS, cliques). Sem ele,
usa scraping via fetch como fallback.

---

## 4. PWA — instalar como app

Depois de `npm run build && npm run start` (ou publicar), abra no Chrome/Edge e
clique no ícone de instalação da barra de endereço. O Octopus vira um app com
janela própria, ícone na área de trabalho e cache offline do shell.

> Em preview/dev o service worker é bloqueado de propósito. Só funciona em build
> real. Para desinstalar, abra a URL com `?sw=off`.
