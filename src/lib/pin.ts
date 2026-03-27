/**
 * Generate a random 4-digit PIN (1000–9999), optionally excluding a specific PIN.
 * Used for group PINs; excludePin prevents collisions with the admin PIN.
 */
export function randomPin(excludePin?: string): string {
  let pin: string;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (pin === excludePin);
  return pin;
}
