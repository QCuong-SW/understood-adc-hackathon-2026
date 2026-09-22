import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type CommunicationPreferences = {
  captionSize: 'small' | 'comfortable' | 'large';
  alertSensitivity: 'low' | 'balanced' | 'high';
  visualPrompts: boolean;
};

const defaults: CommunicationPreferences = {
  captionSize: 'comfortable',
  alertSensitivity: 'balanced',
  visualPrompts: true,
};

@Injectable()
export class PreferencesService {
  constructor(private readonly database: DatabaseService) {}

  get(userId: string) {
    return this.database.get<CommunicationPreferences>('preferences', userId) ?? { ...defaults };
  }

  update(userId: string, changes: Partial<CommunicationPreferences>) {
    const current = this.get(userId);
    const next = { ...current, ...changes };
    this.database.set('preferences', userId, next);
    return next;
  }
}
