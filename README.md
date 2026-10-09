# Aluguéis (Vercel + Turso)

Controle simples dos aluguéis: aluguel mensal, contas de água e luz (divididas entre casas e com controle de quem paga na
companhia), pagamento em Pix/dinheiro/outro, comprovantes, relatórios e planilha CSV.

- `public/`: telas (HTML/CSS/JS puro, sem build), servidas pela Vercel.
- `api/index.js`: o servidor (Express) rodando como função da Vercel.
- **Turso** (SQLite na nuvem): guarda tudo, inclusive as fotos dos comprovantes.
- `server.js`: só para testar no seu computador.

## Publicar (cerca de 15 minutos)

**1. Banco no Turso** (turso.tech, plano grátis). Pelo painel web ou pela CLI:

```bash
turso auth login
turso db locations                      # veja a região mais próxima (São Paulo, se houver)
turso db create alugueis --location gru # troque gru pela região escolhida
turso db show alugueis --url            # copie a URL (libsql://...)
turso db tokens create alugueis         # copie o token
```

**2. GitHub**: crie um repositório (pode ser privado) e envie esta pasta (`node_modules` e `data` já ficam de fora).

**3. Vercel** (vercel.com): *Add New → Project* → importe o repositório → em *Framework Preset* deixe **Other** →
em *Environment Variables* crie:

| Nome | Valor |
| --- | --- |
| `TURSO_DATABASE_URL` | a URL do passo 1 |
| `TURSO_AUTH_TOKEN` | o token do passo 1 |

→ **Deploy**. O `vercel.json` já manda as funções para `gru1` (São Paulo); se a Vercel reclamar da região, apague a linha `"regions"`.

**4. Primeiro acesso**: abra o endereço que a Vercel mostrar e crie o **PIN**. As tabelas são criadas sozinhas.

**5. Seu domínio** (opcional): na Vercel, *Settings → Domains* → adicione, por exemplo, `casas-x7k.rwnanz.online` (troque
`x7k` por 3 letras/números seus; evite nomes óbvios como admin ou aluguel). A Vercel mostra o registro DNS a criar
(normalmente um CNAME). No Cloudflare crie esse registro com a nuvem **cinza (apenas DNS)**, sem proxy.

**6. No celular do pai**: abra o endereço no Chrome, menu (⋮) → **Adicionar à tela inicial**.

## Testar no computador

```bash
npm install
npm start          # http://localhost:3000, usa um arquivo SQLite em ./data
```

Para testar já contra o Turso, defina `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` antes do `npm start`.

## Modos e ajustes (aba Ajustes)

Valem só para o aparelho/navegador onde foram escolhidos.

- **Modo fácil** (padrão no celular): quadros grandes por casa (Aluguel, Água, Luz), só o essencial, lista de contas para pagar.
- **Modo completo** (padrão no computador): tabela com todas as casas e totais, relatórios, correção de valores, excluir contas, backup.
- **Tema**: automático (segue o celular), claro ou escuro. **Tamanho da letra**: Normal, Grande, Maior, Gigante.

## Como usar

- **Casas**: cadastre cada casa (inquilino, aluguel, dia do vencimento). O aluguel do mês é criado sozinho.
  - *Grupo*: casas que dividem a mesma conta de água e luz usam o mesmo nome de grupo (ex.: "Fundos").
  - *Quem paga a água e a luz na companhia*: seu pai, ou a pessoa que cuida da casa. Vem preenchido ao lançar uma conta.
- **Mês**: verde = pago, amarelo = a pagar, vermelho = atrasado, azul = parcial. Toque no quadro para registrar o pagamento
  (valor, Pix/Dinheiro/Outro, data e comprovante em foto ou PDF; em dinheiro não pede comprovante).
- **Água e luz**: "Lançar conta" com o valor total e as casas; duas casas dividem igualmente (o centavo que sobra vai para a
  primeira). Os moradores pagam a parte deles e, separado, você marca quando a conta foi paga na companhia (quem pagou,
  data e comprovante). O resumo do mês avisa "N contas para pagar".
- **Relatório** (modo completo): totais por mês, casa, tipo e forma de recebimento, o que está em aberto e as contas ainda
  não pagas na companhia. "Imprimir ou salvar em PDF" usa o navegador; o CSV abre direto no Excel.

## Backup e PIN

- Em Ajustes (modo completo): **cópia dos dados em JSON** (casas, contas, pagamentos; sem as fotos dos comprovantes). O CSV do relatório também serve de cópia.
- Cópia completa, com as fotos: `turso db shell alugueis .dump > backup.sql`.
- Esqueceu o PIN: `turso db shell alugueis "DELETE FROM settings WHERE key = 'pin_hash'"` e defina outro no próximo acesso
  (local: `npm run reset-pin`).
- Segurança: 8 erros seguidos de PIN bloqueiam aquele IP por 10 minutos (o bloqueio fica no banco, vale para todas as instâncias).

## Limites para lembrar

- Cada comprovante pode ter até **4 MB** (a Vercel recusa requisições acima de 4,5 MB). Fotos são comprimidas pelo próprio app; PDFs grandes, não.
- O plano Hobby da Vercel é para uso pessoal e não comercial. Se isso mudar, o mesmo código roda em qualquer lugar com Node:
  é só ter as duas variáveis do Turso e usar `npm start`.
- Os planos grátis têm cotas (Turso e Vercel). Para 5 casas ficam muito abaixo; veja as páginas de cada serviço se o uso crescer.

Fonte: Atkinson Hyperlegible (licença OFL), servida localmente.
