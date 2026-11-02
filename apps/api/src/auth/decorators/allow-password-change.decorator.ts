import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhenPasswordChangeRequired';

/** Marks a route a user may still call while they must change their one-time password. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
