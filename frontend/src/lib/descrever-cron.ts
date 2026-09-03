/**
 * Descreve um `expr` de cron em português, **no fuso de Brasília**.
 *
 * ⚠️ **O `expr` do gateway é UTC e não tem campo de fuso** — `30 10 * * 1-5` é
 * 07h30 de Brasília, que é a hora em que os briefings da manhã chegam. As duas
 * telas que descreviam cron mostravam a hora crua ("Dias úteis às 10:30"), e o
 * `CronTab` ainda mostra o `expr` colado ao lado: o leitor via 10:30 na tela,
 * recebia o briefing às 07:30 e não tinha como saber qual dos dois estava
 * errado. Por isso o texto diz de quem é o fuso — sem isso, o número certo ao
 * lado do `expr` cru continua parecendo defeito.
 *
 * ⚠️ **Converter a hora pode mudar o DIA.** `30 2 * * 1-5` é 23h30 de domingo a
 * quinta, não "dias úteis". Trocar um erro de hora por um erro de dia seria
 * pior, porque some da vista.
 *
 * O que não sabemos descrever volta cru. Um `expr` legível é resposta honesta;
 * um palpite bonito, não.
 */

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Brasília não tem mais horário de verão (extinto em 2019), então o fuso é
// fixo. Se um dia voltar, esta é a linha que muda.
const FUSO_BRASILIA = -3;

/** Os dias da semana de um campo de cron, ou `null` se não soubermos ler. */
function expandirDias(campo: string): number[] | null {
  const dias = new Set<number>();
  for (const parte of campo.split(",")) {
    if (/^\d+$/.test(parte)) {
      dias.add(Number(parte) % 7); // no cron o domingo é 0 e também é 7
      continue;
    }
    const faixa = parte.match(/^(\d+)-(\d+)$/);
    if (!faixa) return null;
    const [, de, ate] = faixa;
    if (Number(de) > Number(ate)) return null;
    for (let d = Number(de); d <= Number(ate); d++) dias.add(d % 7);
  }
  return [...dias].sort((a, b) => a - b);
}

export function descreverCron(expr: string | null | undefined): string {
  if (!expr) return "";
  const partes = expr.trim().split(/\s+/);
  if (partes.length < 5) return expr;
  const [min, hora, diaDoMes, mes, diaDaSemana] = partes;

  // Estes dois não têm hora do dia para converter.
  if (/^\*\/\d+$/.test(min) && hora === "*") return `A cada ${min.slice(2)} minutos`;
  if (hora === "*" && /^\d+$/.test(min)) return `A cada hora, no minuto ${min}`;

  if (!/^\d+$/.test(hora) || !/^\d+$/.test(min)) return expr;
  // Com dia do mês ou mês fixos, a virada de dia mexeria também neles — e "todo
  // dia 1º" virando "todo dia 30" é o tipo de erro que ninguém confere.
  if (diaDoMes !== "*" || mes !== "*") return expr;

  const deslocada = Number(hora) + FUSO_BRASILIA;
  const viraDia = deslocada < 0;
  const horario = `${String((deslocada + 24) % 24).padStart(2, "0")}h${min.padStart(2, "0")} (Brasília)`;

  if (diaDaSemana === "*") return `Diariamente às ${horario}`;

  const dias = expandirDias(diaDaSemana);
  if (!dias) return expr;
  const ajustados = viraDia
    ? [...new Set(dias.map((d) => (d + 6) % 7))].sort((a, b) => a - b)
    : dias;

  const diasUteis = ajustados.length === 5 && ajustados.every((d, i) => d === i + 1);
  if (diasUteis) return `Dias úteis às ${horario}`;
  return `${ajustados.map((d) => DIAS[d]).join(", ")} às ${horario}`;
}
