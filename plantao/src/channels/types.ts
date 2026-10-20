// Mensagem recebida, já normalizada, venha do Chat Mix ou da Meta.
export interface IncomingMessage {
  channel: "chatmix" | "meta";
  channelNumber: string; // número da empresa que recebeu
  channelMessageId: string;
  from: string; // telefone do cliente, só dígitos
  profileName?: string;
  text?: string;
  media?: { kind: "image" | "audio" | "video"; mediaId: string; mimeType: string };
  receivedAt: Date;
}

export interface ChannelGateway {
  sendText(to: string, text: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
}
