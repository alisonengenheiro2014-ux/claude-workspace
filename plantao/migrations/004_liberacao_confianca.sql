-- Histórico das liberações de confiança feitas pela assistente (a regra conta as dos últimos 30 dias).
create table trust_unlocks (
  id uuid primary key default gen_random_uuid(),
  sgp_customer_id text not null,
  conversation_id uuid references conversations(id) on delete set null,
  hours integer not null check (hours > 0),
  rule text not null,
  created_at timestamptz not null default now()
);
create index on trust_unlocks (sgp_customer_id, created_at);

update knowledge_items
set title = 'Liberação de confiança',
    body = 'Cliente bloqueado por débito pode pedir liberação de confiança. O prazo depende do cadastro (tempo de casa, pagamentos e liberações recentes) e é calculado pelo sistema; a assistente informa o prazo liberado. Quando não é possível liberar, envia a segunda via e registra para a equipe analisar.',
    updated_at = now()
where title in ('Liberação após pagamento', 'Desbloqueio de confiança');
