import type { OperationTypeInput } from '../domain/operation-type.ts';
import type { PartInput } from '../domain/part.ts';

export interface DemoOperation {
  readonly type: string;
  readonly equipment: string | null;
  readonly durationMinutes: number;
}

export interface DemoProcessCard {
  readonly part: string;
  readonly operations: readonly DemoOperation[];
}

export const DEMO_OPERATION_TYPES: readonly OperationTypeInput[] = [
  { name: 'Заготівельна', description: 'Відрізання заготовки з прутка, труби або листа' },
  { name: 'Токарна', description: 'Обробка поверхонь обертання різцями на токарному верстаті' },
  { name: 'Фрезерна', description: 'Обробка площин, уступів, пазів і зубів фрезами' },
  { name: 'Свердлильна', description: 'Свердління, зенкерування та розвертання отворів' },
  {
    name: 'Шліфувальна',
    description: 'Чистова обробка абразивним кругом до точного розміру й низької шорсткості',
  },
  { name: 'Термічна', description: 'Гартування та відпуск для отримання потрібної твердості' },
  { name: 'Слюсарна', description: 'Зняття задирок і притуплення гострих кромок' },
  { name: 'Контрольна', description: 'Перевірка розмірів, форми та шорсткості за кресленням' },
];

export const DEMO_PARTS: readonly PartInput[] = [
  { designation: 'КПІ.301.011', name: 'Вал ведучий', material: 'Сталь 45' },
  { designation: 'КПІ.302.017', name: 'Колесо зубчасте циліндричне', material: 'Сталь 40Х' },
  { designation: 'КПІ.305.004', name: 'Втулка', material: 'Бронза БрО10Ф1' },
  { designation: 'КПІ.310.022', name: 'Корпус підшипника', material: 'Чавун СЧ20' },
  { designation: 'КПІ.320.008', name: 'Фланець', material: 'Сталь 20' },
];

export const DEMO_PROCESS_CARDS: readonly DemoProcessCard[] = [
  {
    part: 'КПІ.301.011',
    operations: [
      { type: 'Заготівельна', equipment: 'Стрічкопильний верстат 8544', durationMinutes: 2.5 },
      { type: 'Токарна', equipment: 'Токарно-гвинторізний верстат 16К20', durationMinutes: 18 },
      { type: 'Фрезерна', equipment: 'Вертикально-фрезерний верстат 6Р12', durationMinutes: 9.5 },
      { type: 'Термічна', equipment: 'Установка СВЧ-гартування', durationMinutes: 45 },
      { type: 'Шліфувальна', equipment: 'Круглошліфувальний верстат 3М151', durationMinutes: 12 },
      { type: 'Контрольна', equipment: null, durationMinutes: 4 },
    ],
  },
  {
    part: 'КПІ.302.017',
    operations: [
      { type: 'Заготівельна', equipment: 'Стрічкопильний верстат 8544', durationMinutes: 3 },
      { type: 'Токарна', equipment: 'Токарний верстат з ЧПК 16А20Ф3', durationMinutes: 22 },
      { type: 'Фрезерна', equipment: 'Зубофрезерний верстат 5К324', durationMinutes: 35 },
      { type: 'Термічна', equipment: 'Шахтна піч', durationMinutes: 60 },
      {
        type: 'Шліфувальна',
        equipment: 'Внутрішньошліфувальний верстат 3К228',
        durationMinutes: 15,
      },
      { type: 'Контрольна', equipment: null, durationMinutes: 5 },
    ],
  },
  {
    part: 'КПІ.305.004',
    operations: [
      { type: 'Токарна', equipment: 'Токарно-револьверний верстат 1П365', durationMinutes: 11.5 },
      {
        type: 'Свердлильна',
        equipment: 'Вертикально-свердлильний верстат 2Н135',
        durationMinutes: 4,
      },
      { type: 'Слюсарна', equipment: 'Верстак слюсарний', durationMinutes: 3 },
      { type: 'Контрольна', equipment: null, durationMinutes: 2 },
    ],
  },
  {
    part: 'КПІ.310.022',
    operations: [
      { type: 'Фрезерна', equipment: 'Горизонтально-фрезерний верстат 6Р82', durationMinutes: 28 },
      {
        type: 'Свердлильна',
        equipment: 'Радіально-свердлильний верстат 2Н55',
        durationMinutes: 14,
      },
      { type: 'Слюсарна', equipment: 'Верстак слюсарний', durationMinutes: 6 },
      { type: 'Контрольна', equipment: null, durationMinutes: 5 },
    ],
  },
];
