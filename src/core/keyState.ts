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
   * Заполняется для `rate_limited` и для `failure`, когда
   * circuit breaker открылся после серии ошибок.
   */
  cooldownUntil?: number;
}

export type KeyStateObserver = (event: KeyStateEvent) => void;
