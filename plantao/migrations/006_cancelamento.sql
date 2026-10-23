-- Pendência de cancelamento (vai para a fila de cancelamentos/retenção).
alter table pending_items drop constraint if exists pending_items_kind_check;
alter table pending_items add constraint pending_items_kind_check
  check (kind in ('chamado_tecnico', 'pre_venda', 'conferir_pagamento', 'cancelamento', 'outro'));
