import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CommunicationPreferences, PreferencesService } from './preferences.service';

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get(':userId')
  get(@Param('userId') userId: string) {
    return this.preferences.get(userId);
  }

  @Patch(':userId')
  update(@Param('userId') userId: string, @Body() changes: Partial<CommunicationPreferences>) {
    return this.preferences.update(userId, changes);
  }
}
