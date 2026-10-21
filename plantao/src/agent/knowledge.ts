// Base de conhecimento. No painel ela vira editável (tabela knowledge_items); aqui ficam os itens iniciais.

export interface KnowledgeItem {
  kind: "plano" | "cobertura" | "faq" | "roteiro_onu" | "politica";
  title: string;
  body: string;
}

// Planos e preços ficam vazios de propósito: o agente só fala deles depois que a equipe cadastrar.
export const BASE_INICIAL: KnowledgeItem[] = [
  {
    kind: "roteiro_onu",
    title: "Luzes da ONU",
    body:
      "POWER aceso: aparelho ligado. PON aceso fixo: fibra sincronizada; piscando: tentando sincronizar. " +
      "LOS apagado é o normal; LOS vermelho ou piscando indica sinal da fibra perdido ou fraco, precisa de técnico.",
  },
  {
    kind: "roteiro_onu",
    title: "Como reiniciar a ONU e o roteador",
    body:
      "Tirar a fonte da ONU da tomada, esperar 30 segundos e ligar de novo. Aguardar uns 3 minutos até as luzes estabilizarem. " +
      "Depois fazer o mesmo com o roteador Wi-Fi. Reiniciar um de cada vez.",
  },
  {
    kind: "faq",
    title: "Internet lenta no Wi-Fi",
    body:
      "Testar perto do roteador, testar em outro aparelho e, se possível, no cabo. Paredes, distância e muitos aparelhos " +
      "conectados reduzem a velocidade do Wi-Fi. Se no cabo também estiver lento, registrar para a equipe.",
  },
  {
    kind: "politica",
    title: "Liberação após pagamento",
    body:
      "Internet bloqueada por débito só é liberada depois que o pagamento é confirmado. A assistente envia a segunda via (boleto e PIX); " +
      "se o cliente já pagou ou mandou comprovante, registra para a equipe conferir.",
  },
];

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");

export function searchKnowledge(items: KnowledgeItem[], query: string, limit = 3): KnowledgeItem[] {
  const terms = normalize(query).split(/\s+/).filter((t) => t.length > 2);
  return items
    .map((item) => {
      const hay = normalize(`${item.title} ${item.body} ${item.kind}`);
      return { item, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
