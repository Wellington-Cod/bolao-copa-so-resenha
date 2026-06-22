# Automação ESPN - Bolão da Copa

Arquivos incluídos:

- `scripts/sync-espn-pending.js`
- `.github/workflows/sync-espn.yml`

## O que faz

A cada 10 minutos, o GitHub Actions:

1. Lê o documento `boloes/copa2026` no Firebase.
2. Procura jogos com `espnId` e `espnCompleted !== true`.
3. Busca a ESPN pelas datas desses jogos.
4. Atualiza no Firebase:
   - `homeScore`
   - `awayScore`
   - `espnState`
   - `espnStatus`
   - `espnCompleted`
   - `espnClock`
   - `espnDisplayClock`
   - `espnLastSyncAt`
5. Grava um resumo em `ultimaAutomacaoEspn`.

## Secret necessário no GitHub

No repositório:

`Settings > Secrets and variables > Actions > New repository secret`

Criar:

`FIREBASE_SERVICE_ACCOUNT_JSON`

Valor: JSON completo da Service Account do Firebase.

## Como gerar o JSON da Service Account

Firebase Console > Project Settings > Service accounts > Generate new private key.

Cole o conteúdo inteiro do JSON no secret.

## Frequência

Começa rodando a cada 10 minutos:

```yaml
- cron: '*/10 * * * *'
```

Depois pode alterar para 5 minutos:

```yaml
- cron: '*/5 * * * *'
```
