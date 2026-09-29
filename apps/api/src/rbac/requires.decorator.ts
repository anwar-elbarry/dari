import { SetMetadata } from '@nestjs/common';
import type { Capability } from './capabilities';

export const REQUIRES = 'requires';

/** The route needs all of these capabilities. */
export const Requires = (...capabilities: [Capability, ...Capability[]]) => SetMetadata(REQUIRES, capabilities);

/** Any signed-in user of any role (e.g. /me). Must be explicit: undeclared routes are refused. */
export const AnyRole = () => SetMetadata(REQUIRES, []);
