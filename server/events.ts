/**
 * In-process change feed for live updates. Every write publishes a small
 * "what changed" message for its tournament; clients listening over
 * Server-Sent Events refetch what they show. One server process, so no broker.
 */

export interface ChangeEvent {
  /** tournament | rounds | groups | golfers | courses | scores | admins */
  c: string;
  /** round the change belongs to, when there is one */
  r?: string;
  /** document id (group id for scores) */
  id?: string;
}

type Listener = (event: ChangeEvent) => void;

export class ChangeFeed {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(tournamentId: string, listener: Listener): () => void {
    let set = this.listeners.get(tournamentId);
    if (!set) {
      set = new Set();
      this.listeners.set(tournamentId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(tournamentId);
    };
  }

  publish(tournamentId: string, event: ChangeEvent): void {
    for (const listener of this.listeners.get(tournamentId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken stream must not stop the others
      }
    }
  }

  listenerCount(tournamentId: string): number {
    return this.listeners.get(tournamentId)?.size ?? 0;
  }
}
