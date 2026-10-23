// Mensagem recebida, já normalizada, venha do MaxChat ou da Meta.
export interface IncomingMessage {
  channel: "chatmix" | "meta" | "maxchat";
  channelNumber: string; // número da empresa que recebeu
  channelMessageId: string;
  from: string; // telefone do cliente, só dígitos
  profileName?: string;
  text?: string;
  media?: { kind: "image" | "audio" | "video"; mediaId: string; mimeType: string };
  receivedAt: Date;
  // o canal informa se há atendente logado agora (MaxChat); false = a IA atende mesmo no horário da equipe
  agentsOnline?: boolean;
}

// O canal recusou o envio porque um atendente assumiu o atendimento (MaxChat responde 409).
export class AtendimentoComHumano extends Error {
  constructor(public phone: string) {
    super("atendimento está com um atendente");
  }
}

export interface TransferInfo {
  department: string;
  reason: string;
  priority: "alta" | "normal" | "baixa";
}

export interface ChannelGateway {
  sendText(to: string, text: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
  // passa o atendimento para uma fila humana (quando o canal tem filas, como o MaxChat)
  transfer?(to: string, info: TransferInfo): Promise<void>;
}
