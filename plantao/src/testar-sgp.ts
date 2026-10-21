// Testa a conexão com o SGP real usando só consultas (não desbloqueia nem abre chamado).
// Uso: npm run testar-sgp -- --cpf 00000000000   (lê SGP_BASE_URL, SGP_APP e SGP_TOKEN do ambiente)
import { loadConfig } from "./config.js";
import { HttpSgp } from "./sgp/http.js";

const i = process.argv.indexOf("--cpf");
const cpf = i > 0 ? process.argv[i + 1] : undefined;
if (!cpf) {
  console.error("uso: npm run testar-sgp -- --cpf 00000000000");
  process.exit(1);
}
const cfg = loadConfig();
const sgp = new HttpSgp({ baseUrl: cfg.SGP_BASE_URL, app: cfg.SGP_APP, token: cfg.SGP_TOKEN, sinalMinimoDbm: cfg.SGP_SINAL_MINIMO_DBM });

const passo = async (nome: string, fn: () => Promise<unknown>) => {
  try {
    const r = await fn();
    console.log(`✔ ${nome}`, JSON.stringify(r, null, 2));
    return r;
  } catch (err) {
    console.log(`✘ ${nome}: ${(err as Error).message}`);
    return null;
  }
};

// diagnóstico: mostra o raw da rota consultacliente para ver campos de telefone
await passo("raw /api/ura/consultacliente/", () => (sgp as any).post("/api/ura/consultacliente/", { cpfcnpj: cpf }));

const cliente = (await passo("cliente pelo CPF", () => sgp.findCustomer({ cpf }))) as { id: string; phones: string[] } | null;
if (cliente) {
  await passo("status da conexão", () => sgp.connectionStatus(cliente.id));
  await passo("faturas em aberto", () => sgp.openInvoices(cliente.id));
  const phone = cliente.phones[0] ?? "61993004207";
  await passo("cliente pelo telefone", () => sgp.findCustomer({ phone }));
}
await passo("leitura das ONUs (varredura de massivo)", async () => {
  const list = await sgp.listConnections();
  return { total: list.length, online: list.filter((x) => x.online).length, exemplo: list.slice(0, 3) };
});
