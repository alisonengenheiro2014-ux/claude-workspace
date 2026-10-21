-- Depois de um massivo, a conversa espera a confirmação do cliente até closing_at; sem resposta, sai a despedida.
alter table conversations add column closing_at timestamptz;
create index on conversations (closing_at) where closing_at is not null and status <> 'closed';

-- Liberação só após o pagamento (sem desbloqueio de confiança pela assistente).
update knowledge_items
set title = 'Liberação após pagamento',
    body = 'Internet bloqueada por débito só é liberada depois que o pagamento é confirmado. A assistente envia a segunda via (boleto e PIX); se o cliente já pagou ou mandou comprovante, registra para a equipe conferir.',
    updated_at = now()
where title = 'Desbloqueio de confiança';
