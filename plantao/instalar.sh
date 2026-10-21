#!/usr/bin/env bash
# Instala o Plantão numa VPS com Docker. Rode dentro da pasta plantao/:  bash instalar.sh
# Pergunta o que precisa, gera senhas, sobe tudo e cria o primeiro usuário do painel.
# Com --so-config, só gera o .env e o Caddyfile (não sobe nada).
set -euo pipefail
cd "$(dirname "$0")"

SO_CONFIG=0
[[ "${1:-}" == "--so-config" ]] && SO_CONFIG=1

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErro: %s\033[0m\n' "$*" >&2; exit 1; }

# grava CHAVE=valor no .env (troca se já existir), sem interpretar caracteres especiais do valor
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  KEY="$key" VALUE="$value" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' .env > "$tmp"
  mv "$tmp" .env
}

ask() { # ask VAR "pergunta" [padrão]
  local var="$1" prompt="$2" def="${3:-}" ans
  read -r -p "$prompt${def:+ [$def]}: " ans || true
  printf -v "$var" '%s' "${ans:-$def}"
}

ask_secret() { # não mostra o que é digitado
  local var="$1" prompt="$2" ans
  read -r -s -p "$prompt (Enter para pular): " ans || true
  echo
  printf -v "$var" '%s' "$ans"
}

if [[ $SO_CONFIG -eq 0 ]]; then
  command -v docker >/dev/null || die "Docker não encontrado. Instale com: curl -fsSL https://get.docker.com | sh"
  docker compose version >/dev/null 2>&1 || die "O plugin 'docker compose' não está disponível."
fi
command -v openssl >/dev/null || die "openssl não encontrado (apt install openssl)."

if [[ -f .env ]]; then
  say "Já existe um .env: vou usar o que está nele (apague-o para configurar do zero)."
else
  say "Configuração"
  cp .env.example .env
  ask DOMINIO "Subdomínio do painel, já apontado para esta VPS (ex.: plantao.maxgiga.com.br)"
  [[ -n "$DOMINIO" ]] || die "o subdomínio é obrigatório (o WhatsApp exige HTTPS)."
  ask_secret ANTHROPIC "Chave da API da Anthropic"
  ask SGP_URL "Endereço do SGP (ex.: https://maxgiga.sgp.net.br)" ""
  SGP_APP_V=""; SGP_TOKEN_V=""
  if [[ -n "$SGP_URL" ]]; then
    ask SGP_APP_V "Nome do app criado no SGP" "plantao"
    ask_secret SGP_TOKEN_V "Token do SGP"
  fi
  ask_secret META_TOKEN "Token de acesso da Meta (WhatsApp Cloud API)"
  META_PHONE=""; META_SECRET=""
  if [[ -n "$META_TOKEN" ]]; then
    ask META_PHONE "Phone number ID do número de teste na Meta"
    ask_secret META_SECRET "App secret do app da Meta"
  fi

  DB_PASS="$(openssl rand -hex 16)"
  set_env PUBLIC_BASE_URL "https://$DOMINIO"
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
  set_env POSTGRES_PASSWORD "$DB_PASS"
  set_env DATABASE_URL "postgres://plantao:$DB_PASS@db:5432/plantao"
  set_env META_VERIFY_TOKEN "$(openssl rand -hex 12)"
  [[ -n "$ANTHROPIC" ]] && set_env ANTHROPIC_API_KEY "$ANTHROPIC"
  if [[ -n "$SGP_URL" && -n "$SGP_TOKEN_V" ]]; then
    set_env SGP_MODO http
    set_env SGP_BASE_URL "$SGP_URL"
    set_env SGP_APP "$SGP_APP_V"
    set_env SGP_TOKEN "$SGP_TOKEN_V"
  fi
  if [[ -n "$META_TOKEN" ]]; then
    set_env META_ACCESS_TOKEN "$META_TOKEN"
    set_env META_PHONE_NUMBER_ID "$META_PHONE"
    set_env META_APP_SECRET "$META_SECRET"
  fi
  chmod 600 .env
  printf '%s {\n\treverse_proxy app:3000\n}\n' "$DOMINIO" > Caddyfile
  say ".env e Caddyfile criados."
fi

[[ $SO_CONFIG -eq 1 ]] && exit 0

say "Subindo banco, aplicação, transcrição de áudio e HTTPS (a primeira vez demora alguns minutos)"
docker compose up -d --build

say "Esperando a aplicação responder"
for _ in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1; break
  fi
  sleep 3
done
[[ "${ok:-0}" -eq 1 ]] || die "a aplicação não respondeu. Veja os logs com: docker compose logs app"

say "Primeiro usuário do painel (administrador)"
ask NOME "Seu nome"
ask EMAIL "Seu e-mail"
docker compose exec app node dist/criar-usuario.js --nome "$NOME" --email "$EMAIL" --papel admin

DOMINIO_ATUAL="$(grep -m1 '^PUBLIC_BASE_URL=' .env | cut -d= -f2-)"
VERIFY="$(grep -m1 '^META_VERIFY_TOKEN=' .env | cut -d= -f2-)"
say "Pronto!"
cat <<EOF
Painel:            $DOMINIO_ATUAL/painel
Webhook da Meta:   $DOMINIO_ATUAL/webhooks/meta
Verify token:      $VERIFY   (cole na configuração do webhook no app da Meta)

Testar o SGP:      docker compose exec app node dist/testar-sgp.js --cpf CPF_DE_UM_CLIENTE
Ver os logs:       docker compose logs -f app
Atualizar:         git pull && docker compose up -d --build
EOF
