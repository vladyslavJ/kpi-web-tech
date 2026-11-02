const MINUTES = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

export function formatDuration(minutes: number): string {
  const tenths = Math.round(minutes * 10);
  const hours = Math.floor(tenths / 600);
  const rest = (tenths - hours * 600) / 10;
  if (hours === 0) {
    return `${MINUTES.format(rest)} хв`;
  }
  return rest === 0 ? `${hours} год` : `${hours} год ${MINUTES.format(rest)} хв`;
}

export function formatMinutes(minutes: number): string {
  return MINUTES.format(minutes);
}

export function formatOperationNumber(number: number): string {
  return String(number).padStart(3, '0');
}

export function sumMinutes(durations: readonly (number | null)[]): number {
  return (
    durations.reduce<number>((total, minutes) => total + Math.round((minutes ?? 0) * 10), 0) / 10
  );
}

export function pluralize(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ${forms[0]}`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
}
