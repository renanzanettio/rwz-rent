// Runner local (desenvolvimento): usa um arquivo SQLite em ./data quando TURSO_DATABASE_URL não está definida.
// Na Vercel quem roda o app é api/index.js.
import app, { resetPin } from './api/index.js';

if (process.argv.includes('--reset-pin')) {
  await resetPin();
  console.log('PIN removido. Abra o sistema no navegador e defina um novo PIN.');
  process.exit(0);
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aluguéis rodando em http://localhost:${PORT}`);
  console.log(process.env.TURSO_DATABASE_URL ? '  banco: Turso' : '  banco: arquivo local em ./data (desenvolvimento)');
});
