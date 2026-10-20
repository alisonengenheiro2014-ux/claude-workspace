-- Horário inicial informado pela Maxgiga: seg-sex 8h-21h, sábado 8h-12h, domingo sem equipe.
insert into business_hours (weekday, opens_at, closes_at)
select d, time '08:00', time '21:00' from generate_series(1, 5) as d
union all select 6, time '08:00', time '12:00';

-- Base inicial. Planos e preços ficam para a equipe cadastrar no painel.
insert into knowledge_items (kind, title, body) values
('roteiro_onu', 'Luzes da ONU',
 'POWER aceso: aparelho ligado. PON aceso fixo: fibra sincronizada; piscando: tentando sincronizar. LOS apagado é o normal; LOS vermelho ou piscando indica sinal da fibra perdido ou fraco, precisa de técnico.'),
('roteiro_onu', 'Como reiniciar a ONU e o roteador',
 'Tirar a fonte da ONU da tomada, esperar 30 segundos e ligar de novo. Aguardar uns 3 minutos até as luzes estabilizarem. Depois fazer o mesmo com o roteador Wi-Fi. Reiniciar um de cada vez.'),
('faq', 'Internet lenta no Wi-Fi',
 'Testar perto do roteador, testar em outro aparelho e, se possível, no cabo. Paredes, distância e muitos aparelhos conectados reduzem a velocidade do Wi-Fi. Se no cabo também estiver lento, registrar para a equipe.'),
('politica', 'Desbloqueio de confiança',
 'Libera a conexão por alguns dias enquanto o pagamento é feito. O prazo e o limite de uso seguem a regra do sistema.');
