// Cria um usuário do painel. Uso: npm run criar-usuario -- --nome "Fulano" --email a@b.com --papel admin
// A senha é pedida no terminal (não fica no histórico do shell).
import pg from "pg";
import readline from "node:readline/promises";
import { hashPassword } from "./panel/auth.js";
import { PgStore } from "./store/pg.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const nome = arg("nome");
const email = arg("email")?.trim().toLowerCase();
const papel = arg("papel") === "admin" ? "admin" : "atendente";
if (!nome || !email) {
  console.error('uso: npm run criar-usuario -- --nome "Fulano" --email a@b.com [--papel admin]');
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const senha = await rl.question("Senha (mín. 10 caracteres): ");
rl.close();
if (senha.length < 10) {
  console.error("senha curta demais");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const user = await new PgStore(pool).createUser({ name: nome, email, passwordHash: await hashPassword(senha), role: papel });
console.log(`usuário criado: ${user.email} (${user.role})`);
await pool.end();
