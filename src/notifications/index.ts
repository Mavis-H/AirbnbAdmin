export interface NotificationPerson {
  id: number;
  name: string;
  notify_method: string;
}

// Phase 1 stub — logs to console. Phase 3 swaps this for the WeCom API call.
export function sendNotification(person: NotificationPerson, message: string): void {
  console.log(`[notify → ${person.name} (${person.notify_method})]: ${message}`);
}
