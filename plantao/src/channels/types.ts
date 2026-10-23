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
