/**
 * Событие изменения состояния API-ключа.
 *
 * Router не пишет в БД сам: он лишь сообщает наблюдателю, что
 * произошло с ключом. Слой `db` превращает событие в UPDATE.
 */
export type KeyStateEventType =
  | 'success'
  | 'rate_limited'
  | 'invalid'
  | 'failure';

export interface KeyStateEvent {
  keyId: string;
  type: KeyStateEventType;
  /** Момент события в epoch-миллисекундах. */
  at: number;
  /**
   * До какого момента ключ должен быть в cooldown.
   * Заполняется только для `rate_limited`.
   */
  cooldownUntil?: number;
}

export type KeyStateObserver = (event: KeyStateEvent) => void;
