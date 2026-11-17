// "Versão 17/11 16:40": when this build was published, in the phone's time.
export const VERSION = new Date(__BUILD__).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
