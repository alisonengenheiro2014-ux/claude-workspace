-- Plantão Maxgiga: schema inicial (Postgres 16)
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','atendente')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_hours (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_window check (closes_at > opens_at)
);
create index on business_hours (weekday);

create table holidays (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- E.164
  name text,
  cpf text,
  sgp_customer_id text,
  kind text not null default 'desconhecido' check (kind in ('desconhecido','cliente','lead')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contacts (sgp_customer_id);
create index on contacts (cpf);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  area_type text not null check (area_type in ('pop','olt','pon','manual')),
  area_id text not null,
  status text not null default 'suspeito' check (status in ('suspeito','confirmado','resolvido','descartado')),
  message text not null,
  eta timestamptz,
  detected_by text not null check (detected_by in ('varredura','equipe')),
  opened_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_open_incident_per_area on incidents (area_type, area_id) where status in ('suspeito','confirmado');
create index on incidents (status);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null check (channel in ('chatmix','meta')),
  channel_number text not null,             -- qual dos 4 números
  status text not null default 'ia' check (status in ('ia','aguardando_equipe','humano','closed')),
  topic text check (topic in ('sem_internet','financeiro','pre_venda','visita_tecnica','massivo','outro')),
  resolved_by text check (resolved_by in ('ia','equipe')),
  incident_id uuid references incidents(id) on delete set null,
  ai_started_at timestamptz,
  ai_finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index one_open_conversation_per_contact on conversations (contact_id) where status <> 'closed';
create index on conversations (status, created_at);
create index on conversations (incident_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author text not null check (author in ('cliente','ia','humano','sistema')),
  body text,
  media_url text,
  channel_message_id text unique,           -- idempotência do webhook
  delivery_status text check (delivery_status in ('pendente','enviado','entregue','lido','erro')),
  sent_at timestamptz not null default now()
);
create index on messages (conversation_id, sent_at);

create table incident_contacts (
  incident_id uuid not null references incidents(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  last_contact_at timestamptz not null default now(),
  notified_eta_at timestamptz,
  notified_resolved_at timestamptz,
  primary key (incident_id, contact_id)
);
create index on incident_contacts (contact_id);

create table pending_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  kind text not null check (kind in ('chamado_tecnico','pre_venda','conferir_pagamento','outro')),
  priority smallint not null default 2 check (priority between 1 and 3), -- 1 = LOS/urgente
  summary text not null,
  data jsonb not null default '{}',
  sgp_ticket_id text,
  status text not null default 'aberto' check (status in ('aberto','feito')),
  done_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index on pending_items (status, priority, created_at);

create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('plano','cobertura','faq','roteiro_onu','politica')),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on knowledge_items (kind) where active;

create table sgp_status_snapshots (
  sgp_customer_id text primary key,
  area_pop text,
  area_olt text,
  area_pon text,
  online boolean not null,
  changed_at timestamptz not null,          -- quando mudou de estado
  checked_at timestamptz not null default now()
);
create index on sgp_status_snapshots (area_pon, online, changed_at);
create index on sgp_status_snapshots (area_olt, online, changed_at);
