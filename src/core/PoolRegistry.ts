import type { KeyPool } from './KeyPool.js';

export type KeyPoolFactory = (providerId: string) => Promise<KeyPool>;

/**
 * Минимальный интерфейс, который нужен Router-слою.
 * Благодаря ему DeploymentResolver можно тестировать
 * без настоящего PoolRegistry.
 */
export interface KeyPoolProvider {
  get(providerId: string): Promise<KeyPool>;
}

/**
 * Кэш пулов ключей по провайдерам.
 *
 * Зачем нужен кэш:
 * - KeyPool хранит cooldown и invalid-состояния в памяти;
 * - если создавать пул на каждый запрос, эти состояния теряются;
 * - повторная загрузка ключей из БД на каждый запрос — лишняя работа.
 *
 * В кэше лежит Promise, а не готовый KeyPool. Это защищает от
 * «thundering herd»: несколько одновременных запросов к одному
 * провайдеру запустят только одну загрузку ключей.
 */
export class PoolRegistry implements KeyPoolProvider {
  private readonly pools = new Map<string, Promise<KeyPool>>();

  constructor(private readonly createPool: KeyPoolFactory) {}

  get size(): number {
    return this.pools.size;
  }

  async get(providerId: string): Promise<KeyPool> {
    const cached = this.pools.get(providerId);

    if (cached !== undefined) {
      return cached;
    }

    const pending = this.createPool(providerId);
    this.pools.set(providerId, pending);

    try {
      return await pending;
    } catch (error) {
      // Неудачную загрузку не кэшируем: следующий запрос
      // должен иметь возможность попробовать снова.
      this.pools.delete(providerId);
      throw error;
    }
  }

  /**
   * Принудительно перезагружает ключи провайдера.
   * Пригодится после изменения ключей в админке.
   */
  async refresh(providerId: string): Promise<KeyPool> {
    this.pools.delete(providerId);
    return this.get(providerId);
  }

  clear(providerId?: string): void {
    if (providerId === undefined) {
      this.pools.clear();
      return;
    }

    this.pools.delete(providerId);
  }
}
