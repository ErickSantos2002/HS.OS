# Código legado — conservado, não usado

Nada aqui está em uso. Estes arquivos saíram do fluxo do aplicativo mas foram
mantidos porque ainda carregam informação útil sobre como o sistema de origem
funcionava — contratos com o gateway, sequência de configuração, textos.

**Não importe nada daqui em código vivo.** Para reaproveitar algo, copie o
trecho para o lugar novo em vez de criar dependência com esta pasta.

A pasta está fora do `tsconfig.app.json` (`exclude`), então o `tsc` não a
verifica. É deliberado: estes arquivos ainda importam
`@/integrations/supabase/client`, e sem a exclusão eles quebrariam o typecheck
no dia em que o client do Supabase for removido. Como nada os importa, o bundle
também não os inclui.

## setup/ — o wizard de configuração inicial

Aposentado em 05/08/2026. Era o onboarding do cliente do programa de IAficação
da dn.ia, em 6 passos: contratar VPS na Hostinger com cupom de desconto,
publicar a instância no Lovable, rodar um instalador por SSH, cadastrar time,
empresa e plataformas, e ativar.

Nada disso se aplica ao HS.OS: a Health & Safety já tem VPS, já tem Postgres
próprio e configura o gateway direto. O wizard também prendia o `super_admin`
numa tela obrigatória no primeiro acesso (`OnboardingGate`), o que bloqueava o
app inteiro enquanto o passo a passo não fosse concluído.

O que ainda pode valer a pena olhar aqui:

- **`components/Step1Gateway.tsx`** — como a conexão com o OpenClaw Gateway é
  testada e gravada em `public.vps_config`. É a referência mais direta para
  quando formos portar a configuração do gateway.
- **`components/Step3Company.tsx`** — `persistCompanyProfile()` e o formato do
  registro em `public.company_profile`.
- **`components/Step2Team.tsx`** — fluxo de convite e criação de membros.
- **`components/Step0PrepGateway.tsx`** — os comandos de instalação do OpenClaw
  no servidor, úteis se um dia a gente automatizar o provisionamento.

O que não vale: os textos de venda (Hostinger, cupom, Lovable) e a lógica de
"primeiro acesso", que não existe mais.
