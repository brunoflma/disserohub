import { tr } from '../../../shared/i18n';
import type { IdleActivity } from '../world/sim/behavior';

export const LEGAL_SOCIAL = {
  label: tr('Debatendo teses'),
  invite: [tr('Vamos debater uma tese na Sala de Convivência?'), tr('Podemos comparar os argumentos à mesa?'), tr('Vamos revisar os fundamentos juntos?')],
  accept: [tr('Vamos examinar os argumentos.'), tr('Levo minhas anotações.'), tr('Podemos consultar as fontes juntos.')],
  discuss: [
    tr('Qual é o fundamento central desta tese?'),
    tr('Vamos considerar também a tese contrária.'),
    tr('Precisamos conferir a fonte original do precedente.'),
    tr('As situações de fato são comparáveis?'),
    tr('Como distinguir a regra das exceções?'),
    tr('Qual é a objeção mais forte a esse argumento?'),
    tr('A conclusão acompanha os fundamentos apresentados?'),
    tr('Vamos organizar os pontos para a próxima reunião.'),
  ],
  respond: [tr('Precisamos examinar esse fundamento.'), tr('Vamos comparar as interpretações.'), tr('Podemos consultar o texto original.'), tr('Anotei esse ponto para aprofundarmos.')],
} as const;

/** Favor library reading while retaining visits to the other common areas. */
export function legalIdleWeights(w: Readonly<Record<IdleActivity, number>>): Readonly<Record<IdleActivity, number>> {
  return { ...w, lounge: w.lounge * 1.5, shelf: w.shelf * 2, phone: 0, arcade: 0, pingpong: 0 };
}
